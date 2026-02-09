#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Bridges Objective-C @try/@catch into Swift.  Swift's do/catch cannot
/// intercept NSException (e.g. from AVAudioNode.installTap), so this
/// small helper lets callers recover gracefully instead of crashing.
@interface ObjCExceptionCatcher : NSObject

/// Runs *block* inside @try.  Returns YES on success.
/// If an NSException is thrown, captures it as an NSError and returns NO.
+ (BOOL)performBlock:(void (NS_NOESCAPE ^)(void))block
               error:(NSError *_Nullable *_Nullable)error;

@end

NS_ASSUME_NONNULL_END
