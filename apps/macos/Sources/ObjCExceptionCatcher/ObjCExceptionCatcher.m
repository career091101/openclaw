#import "include/ObjCExceptionCatcher.h"

@implementation ObjCExceptionCatcher

+ (BOOL)performBlock:(void (NS_NOESCAPE ^)(void))block
               error:(NSError *_Nullable *_Nullable)error {
    @try {
        block();
        return YES;
    } @catch (NSException *exception) {
        if (error) {
            NSDictionary *info = @{
                NSLocalizedDescriptionKey: exception.reason ?: @"Unknown NSException",
                @"ExceptionName": exception.name ?: @"",
            };
            *error = [NSError errorWithDomain:@"ObjCExceptionCatcher"
                                         code:-1
                                     userInfo:info];
        }
        return NO;
    }
}

@end
