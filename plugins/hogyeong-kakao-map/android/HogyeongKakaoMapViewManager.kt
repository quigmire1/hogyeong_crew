package com.quigmire1.hogyeongcrew.map

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class HogyeongKakaoMapViewManager : SimpleViewManager<HogyeongKakaoMapView>() {
  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(reactContext: ThemedReactContext): HogyeongKakaoMapView =
    HogyeongKakaoMapView(reactContext)

  @ReactProp(name = "appKey")
  fun setAppKey(view: HogyeongKakaoMapView, value: String?) {
    view.setAppKey(value)
  }

  @ReactProp(name = "camera")
  fun setCamera(view: HogyeongKakaoMapView, value: ReadableMap?) {
    view.setCamera(value)
  }

  @ReactProp(name = "currentLocation")
  fun setCurrentLocation(view: HogyeongKakaoMapView, value: ReadableMap?) {
    view.setCurrentLocation(value)
  }

  @ReactProp(name = "routeCoordinates")
  fun setRouteCoordinates(view: HogyeongKakaoMapView, value: ReadableArray?) {
    view.setRouteCoordinates(value)
  }

  @ReactProp(name = "photoMarkers")
  fun setPhotoMarkers(view: HogyeongKakaoMapView, value: ReadableArray?) {
    view.setPhotoMarkers(value)
  }

  companion object {
    const val REACT_CLASS = "HogyeongKakaoMapView"
  }
}
