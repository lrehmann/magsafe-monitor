#include "charger-usb.h"
#include <stdint.h>
#include <stdio.h>
#include <string.h>

enum { report_id = 2, hid_header_size = 6, uarp_header_size = 6 };
enum { sync_request = 0, version_request = 1, info_request = 3, apple_info_request = 0xffff };
static const uint8_t apple_vendor_request[] = {0xbc, 0x09, 0x63, 0, 0x20};
static const uint8_t apple_vendor_reply[] = {0xbc, 0x09, 0x63, 0, 0x21};

struct probe {
    IOHIDDeviceRef device;
    uint16_t message_id;
    uint16_t expected_type;
    uint32_t property;
    bool received;
    bool success;
    uint8_t input[4097];
};

static uint16_t big16(const uint8_t *p) { return ((uint16_t)p[0] << 8) | p[1]; }
static uint16_t little16(const uint8_t *p) { return ((uint16_t)p[1] << 8) | p[0]; }
static uint32_t big32(const uint8_t *p) { return ((uint32_t)big16(p) << 16) | big16(p + 2); }

static void receive(void *context, IOReturn result, void *sender, IOHIDReportType type,
                    uint32_t id, uint8_t *data, CFIndex length) {
    (void)sender;
    struct probe *probe = context;
    if (result || type != kIOHIDReportTypeInput || id != report_id || probe->received) return;
    if (length < 1 + hid_header_size + uarp_header_size || data[0] != report_id) return;
    const uint8_t *message = data + 1 + hid_header_size;
    const uint8_t *body = message + uarp_header_size;
    uint16_t body_length = big16(message + 2);
    uint16_t frame_length = little16(data + 5);
    CFIndex frame_end = 1 + hid_header_size + frame_length;
    if (big16(message) != probe->expected_type || frame_length != body_length + uarp_header_size
        || frame_end > length) return;
    for (CFIndex i = frame_end; i < length; i++) if (data[i] != 0) return;

    if (probe->expected_type == 0) {
        if (body_length != 0) return;
        probe->success = true;
    } else if (probe->expected_type == 2) {
        if (body_length != 4) return;
        printf("version %u %u\n", big16(body), big16(body + 2));
        probe->success = big16(body) == 0 && big16(body + 2) >= 1;
    } else if (probe->expected_type == apple_info_request) {
        if (body_length < 17 || memcmp(body, apple_vendor_reply, sizeof(apple_vendor_reply))) return;
        uint32_t status = big32(body + 5);
        if (status == 0 && (big32(body + 9) != probe->property || big32(body + 13) != body_length - 17u)) return;
        printf("apple-property %u %u ", probe->property, status);
        for (size_t i = 17; status == 0 && i < body_length; i++) printf("%02x", body[i]);
        putchar('\n');
        probe->success = status == 0;
    } else {
        if (body_length < 2) return;
        uint16_t status = big16(body);
        if (status == 0 && (body_length < 10 || big32(body + 2) != probe->property
                            || big32(body + 6) != body_length - 10u)) return;
        printf("property %u %u ", probe->property, status);
        for (size_t i = 10; status == 0 && i < body_length; i++) printf("%02x", body[i]);
        putchar('\n');
        probe->success = status == 0;
    }
    probe->received = true;
    CFRunLoopStop(CFRunLoopGetCurrent());
}

static bool exchange(struct probe *probe, uint16_t type, uint16_t argument) {
    uint8_t size = 0;
    if (type == apple_info_request) size = 9;
    else if (type == info_request) size = 4;
    else if (type == version_request) size = 2;
    uint16_t id = probe->message_id++;
    uint16_t seq = id + 1;
    uint8_t frame[hid_header_size + uarp_header_size + 9] = {
        0x02, 0x40, seq & 255, seq >> 8, uarp_header_size + size, 0,
        type >> 8, type & 255, 0, size, id >> 8, id & 255,
    };
    if (type == apple_info_request) {
        memcpy(frame + hid_header_size + uarp_header_size, apple_vendor_request, sizeof(apple_vendor_request));
    }
    if (size) {
        uint8_t *body = frame + hid_header_size + uarp_header_size;
        body[size - 2] = argument >> 8;
        body[size - 1] = argument & 255;
    }
    probe->expected_type = type == sync_request || type == apple_info_request ? type : type + 1;
    probe->property = argument;
    probe->received = probe->success = false;

    // Apple's USB UARP transport passes the report ID separately to IOHIDDeviceSetReport.
    IOReturn status = IOHIDDeviceSetReport(probe->device, kIOHIDReportTypeOutput, report_id,
                                          frame, hid_header_size + uarp_header_size + size);
    if (status != kIOReturnSuccess) {
        fprintf(stderr, "HID write failed (0x%08x).\n", status);
        return false;
    }
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.8, false);
    if (!probe->received) {
        if (type == info_request) printf("timeout %u\n", argument);
        else if (type == apple_info_request) printf("apple-timeout %u\n", argument);
        else fputs("The charger did not answer the UARP handshake.\n", stderr);
    }
    return probe->success;
}

int main(void) {
    IOHIDManagerRef manager = IOHIDManagerCreate(NULL, kIOHIDOptionsTypeNone);
    const int usage = 0x46;
    CFSetRef devices = chargerInterfaces(manager, &usage, 1);
    bool ready = false;
    if (!devices || CFSetGetCount(devices) != 1) {
        fputs("Connect one supported Apple MagSafe charger (05AC:0500 or 05AC:0506) over USB.\n", stderr);
        goto cleanup;
    }
    struct probe probe = {0};
    CFSetGetValues(devices, (const void **)&probe.device);
    int product = hidNumber(probe.device, CFSTR(kIOHIDProductIDKey));
    printf("usb %d %d\n", product, hidNumber(probe.device, CFSTR(kIOHIDVersionNumberKey)));
    IOReturn status = IOHIDDeviceOpen(probe.device, kIOHIDOptionsTypeNone);
    if (status != kIOReturnSuccess) {
        fprintf(stderr, "Could not open the MagSafe UARP interface (0x%08x).\n", status);
        goto cleanup;
    }
    IOHIDDeviceRegisterInputReportCallback(probe.device, probe.input, sizeof(probe.input), receive, &probe);
    IOHIDDeviceScheduleWithRunLoop(probe.device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    ready = exchange(&probe, sync_request, 0) && exchange(&probe, version_request, 1);
    if (ready) {
        const uint16_t properties[] = {1, 2, 4, 5, 6, 7, 8};
        for (size_t i = 0; i < sizeof(properties) / sizeof(properties[0]); i++) {
            exchange(&probe, info_request, properties[i]);
        }
        if (product == a2140ProductId) exchange(&probe, apple_info_request, 2);
    }
    IOHIDDeviceUnscheduleFromRunLoop(probe.device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOHIDDeviceClose(probe.device, kIOHIDOptionsTypeNone);
cleanup:
    if (devices) CFRelease(devices);
    CFRelease(manager);
    return ready ? 0 : 1;
}
