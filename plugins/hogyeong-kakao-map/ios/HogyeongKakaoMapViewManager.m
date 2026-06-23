#import <React/RCTViewManager.h>
#import "hogyeongcrew-Swift.h"

@interface HogyeongKakaoMapViewManager : RCTViewManager
@end

@implementation HogyeongKakaoMapViewManager

RCT_EXPORT_MODULE(HogyeongKakaoMapView)

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (UIView *)view
{
  return [HogyeongKakaoMapView new];
}

RCT_EXPORT_VIEW_PROPERTY(appKey, NSString)
RCT_EXPORT_VIEW_PROPERTY(camera, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(currentLocation, NSDictionary)
RCT_EXPORT_VIEW_PROPERTY(routeCoordinates, NSArray)
RCT_EXPORT_VIEW_PROPERTY(photoMarkers, NSArray)

@end
