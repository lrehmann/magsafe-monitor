#include "charger-usb.h"
#include <libusb.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static volatile sig_atomic_t stopped = 0;
static bool disconnected = false;
static bool ready = false;

struct input {
    IOHIDDeviceRef device;
    int product;
    int usage;
    bool listening;
    uint8_t report[4097];
};

static void stop(int signalNumber) {
    (void)signalNumber;
    stopped = 1;
}

static void deviceRemoved(void *context, IOReturn result, void *sender) {
    (void)context;
    (void)result;
    (void)sender;
    disconnected = true;
    CFRunLoopStop(CFRunLoopGetCurrent());
}

static void onReport(void *context, IOReturn result, void *sender, IOHIDReportType type,
                     uint32_t reportId, uint8_t *data, CFIndex length) {
    (void)sender;
    const struct input *input = context;
    if (!ready || stopped || result != kIOReturnSuccess || type != kIOHIDReportTypeInput || length < 1) return;
    if (input->product == a2140ProductId && (reportId != 0x02 || length < 2 || data[0] != reportId)) return;

    double timestamp = (CFAbsoluteTimeGetCurrent() + kCFAbsoluteTimeIntervalSince1970) * 1000;
    printf("{\"type\":\"report\",\"at\":%.0f,\"usage\":%d,\"reportId\":%u,\"hex\":\"",
           timestamp, input->usage, reportId);
    for (CFIndex i = 0; i < length; i++) printf("%02x", data[i]);
    puts("\"}");
    if (fflush(stdout) == EOF) stopped = 1;
}

static int setReports(libusb_device_handle *device, bool enable) {
    unsigned char command[] = {0x0b, enable};
    return libusb_control_transfer(device, 0x21, 0x09, 0x030b, 0, command, sizeof(command), 700);
}

static libusb_device_handle *openA2140(libusb_context *context) {
    libusb_device **devices;
    ssize_t count = libusb_get_device_list(context, &devices);
    if (count < 0) return NULL;
    libusb_device *charger = NULL;
    unsigned matches = 0;
    for (ssize_t i = 0; i < count; i++) {
        struct libusb_device_descriptor descriptor;
        if (libusb_get_device_descriptor(devices[i], &descriptor) == 0 &&
            descriptor.idVendor == appleVendorId && descriptor.idProduct == a2140ProductId) {
            charger = devices[i];
            matches++;
        }
    }
    libusb_device_handle *handle = NULL;
    if (matches == 1) libusb_open(charger, &handle);
    libusb_free_device_list(devices, 1);
    return handle;
}

static int readA2140Features(void) {
    libusb_context *context = NULL;
    if (libusb_init(&context) != 0) return 1;
    libusb_device_handle *device = openA2140(context);
    if (!device) {
        libusb_exit(context);
        return 1;
    }
    const struct { uint8_t id; unsigned length; } reports[] = {
        {0xb4, 3}, {0x13, 2}, {0x40, 2}, {0xe0, 9}, {0xb2, 3}, {0xba, 3}, {0xbb, 129}, {0xbc, 3},
    };
    for (size_t i = 0; i < sizeof(reports) / sizeof(reports[0]); i++) {
        uint8_t bytes[129];
        uint8_t id = reports[i].id;
        int length = libusb_control_transfer(device, 0xa1, 0x01, 0x0300 | id, 0, bytes, reports[i].length, 700);
        if (length < 2 || bytes[0] != id) continue;
        printf("%02x ", id);
        for (int b = 1; b < length; b++) printf("%02x", bytes[b]);
        putchar('\n');
    }
    libusb_close(device);
    libusb_exit(context);
    return 0;
}

int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "--features") == 0) return readA2140Features();
    signal(SIGINT, stop);
    signal(SIGTERM, stop);
    signal(SIGPIPE, SIG_IGN);

    int status = 1;
    IOHIDManagerRef manager = IOHIDManagerCreate(NULL, kIOHIDOptionsTypeNone);
    const int usages[] = {0x10, 0x11};
    CFSetRef interfaces = chargerInterfaces(manager, usages, sizeof(usages) / sizeof(usages[0]));
    IOHIDDeviceRef devices[2];
    struct input inputs[2] = {0};
    libusb_context *usbContext = NULL;
    libusb_device_handle *control = NULL;
    bool enabled = false;
    CFIndex count = interfaces ? CFSetGetCount(interfaces) : 0;

    if (count < 1 || count > 2) {
        puts("{\"type\":\"error\",\"message\":\"Connect one supported Apple MagSafe charger by USB (05AC:0500 or 05AC:0506).\"}");
        goto cleanup;
    }
    CFSetGetValues(interfaces, (const void **)devices);
    int product = hidNumber(devices[0], CFSTR(kIOHIDProductIDKey));
    int location = hidNumber(devices[0], CFSTR(kIOHIDLocationIDKey));
    int version = hidNumber(devices[0], CFSTR(kIOHIDVersionNumberKey));
    // These four builds have the same retail Feature 0x0B registration.
    bool dotara = product == a2140ProductId && (version == 0x0174 || version == 0x0247 || version == 0x0255 || version == 0x0258);
    if (count == 2 && (product != a2580ProductId || !location || hidNumber(devices[1], CFSTR(kIOHIDLocationIDKey)) != location ||
                       hidNumber(devices[1], CFSTR(kIOHIDProductIDKey)) != product ||
                       hidNumber(devices[1], CFSTR(kIOHIDPrimaryUsageKey)) == hidNumber(devices[0], CFSTR(kIOHIDPrimaryUsageKey)))) {
        puts("{\"type\":\"error\",\"message\":\"Connect one supported MagSafe charger at a time.\"}");
        goto cleanup;
    }

    for (CFIndex i = 0; i < count; i++) {
        struct input *input = &inputs[i];
        input->device = devices[i];
        input->product = product;
        input->usage = hidNumber(devices[i], CFSTR(kIOHIDPrimaryUsageKey));
        if (IOHIDDeviceOpen(input->device, kIOHIDOptionsTypeNone) != kIOReturnSuccess) continue;
        IOHIDDeviceRegisterInputReportCallback(input->device, input->report, sizeof(input->report), onReport, input);
        IOHIDDeviceRegisterRemovalCallback(input->device, deviceRemoved, NULL);
        IOHIDDeviceScheduleWithRunLoop(input->device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        input->listening = true;
    }
    if (!inputs[0].listening && !inputs[1].listening) {
        puts("{\"type\":\"error\",\"message\":\"macOS could not open the charger’s input interfaces.\"}");
        goto cleanup;
    }
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.1, false);

    if (dotara) {
        if (!stopped && !disconnected && libusb_init(&usbContext) == 0) control = openA2140(usbContext);
        if (!control || setReports(control, true) != 2) {
            puts("{\"type\":\"error\",\"message\":\"The A2140 live stream could not be enabled. Connect one A2140 and try again.\"}");
            goto cleanup;
        }
        enabled = true;
    }

    printf("{\"type\":\"ready\",\"productId\":%d,\"usbVersion\":%d,\"mode\":\"%s\",\"usages\":[",
           product, version, dotara ? "dotara" : "raw");
    const char *separator = "";
    for (CFIndex i = 0; i < count; i++) {
        if (!inputs[i].listening) continue;
        printf("%s%d", separator, inputs[i].usage);
        separator = ",";
    }
    puts("]}");
    ready = true;
    if (fflush(stdout) == EOF) stopped = 1;
    while (!stopped && !disconnected) {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.5, false);
        puts("{\"type\":\"heartbeat\"}");
        if (fflush(stdout) == EOF) break;
    }
    if (disconnected) puts("{\"type\":\"error\",\"message\":\"The charger disconnected.\"}");
    status = 0;

cleanup:
    if (enabled && !disconnected && setReports(control, false) != 2) {
        fputs("Could not stop USB reports from the MagSafe charger.\n", stderr);
        status = 1;
    }
    if (control) libusb_close(control);
    if (usbContext) libusb_exit(usbContext);
    for (size_t i = 0; i < sizeof(inputs) / sizeof(inputs[0]); i++) {
        if (!inputs[i].listening) continue;
        IOHIDDeviceUnscheduleFromRunLoop(inputs[i].device, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
        IOHIDDeviceClose(inputs[i].device, kIOHIDOptionsTypeNone);
    }
    if (interfaces) CFRelease(interfaces);
    CFRelease(manager);
    return status;
}
