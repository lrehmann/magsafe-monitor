#ifndef MAGSAFE_CHARGER_USB_H
#define MAGSAFE_CHARGER_USB_H

#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <IOKit/hid/IOHIDKeys.h>

enum { appleVendorId = 0x05ac, a2140ProductId = 0x0500, a2580ProductId = 0x0506 };

static inline int hidNumber(IOHIDDeviceRef device, CFStringRef key) {
    CFTypeRef property = IOHIDDeviceGetProperty(device, key);
    int value = 0;
    if (property && CFGetTypeID(property) == CFNumberGetTypeID()) {
        CFNumberGetValue(property, kCFNumberIntType, &value);
    }
    return value;
}

static inline CFSetRef chargerInterfaces(IOHIDManagerRef manager, const int *usages, size_t usageCount) {
    const int products[] = {a2140ProductId, a2580ProductId};
    const void *keys[] = {
        CFSTR(kIOHIDVendorIDKey), CFSTR(kIOHIDProductIDKey),
        CFSTR(kIOHIDPrimaryUsagePageKey), CFSTR(kIOHIDPrimaryUsageKey),
    };
    CFMutableArrayRef matches = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
    for (size_t p = 0; p < sizeof(products) / sizeof(products[0]); p++) {
        for (size_t u = 0; u < usageCount; u++) {
            if (products[p] == a2140ProductId && usages[u] == 0x10) continue;
            const int ids[] = {appleVendorId, products[p], 0xff00, usages[u]};
            const void *values[4];
            for (size_t i = 0; i < 4; i++) values[i] = CFNumberCreate(NULL, kCFNumberIntType, &ids[i]);
            CFDictionaryRef match = CFDictionaryCreate(NULL, keys, values, 4,
                                                       &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
            CFArrayAppendValue(matches, match);
            CFRelease(match);
            for (size_t i = 0; i < 4; i++) CFRelease(values[i]);
        }
    }
    IOHIDManagerSetDeviceMatchingMultiple(manager, matches);
    CFRelease(matches);
    return IOHIDManagerCopyDevices(manager);
}

#endif
