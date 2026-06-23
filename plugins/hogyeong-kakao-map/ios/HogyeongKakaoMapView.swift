import KakaoMapsSDK
import UIKit

@objc(HogyeongKakaoMapView)
public final class HogyeongKakaoMapView: UIView {
  @objc public var appKey: NSString? {
    didSet {
      ensureStarted()
    }
  }

  @objc public var camera: NSDictionary? {
    didSet {
      cameraState = CameraState(dictionary: camera)
      moveCamera()
    }
  }

  @objc public var routeCoordinates: NSArray? {
    didSet {
      renderRoute()
    }
  }

  @objc public var currentLocation: NSDictionary? {
    didSet {
      renderCurrentLocation()
    }
  }

  @objc public var photoMarkers: NSArray? {
    didSet {
      renderPhotoMarkers()
    }
  }

  private static var sdkInitializedKeys = Set<String>()

  private let container = KMViewContainer()
  private lazy var controller = KMController(viewContainer: container)

  private var cameraState = CameraState()
  private var isStarted = false
  private var shouldForceInitialRender = false
  private var routeStyleSetAdded = false
  private var photoRenderVersion = 0

  public override init(frame: CGRect) {
    super.init(frame: frame)
    setUp()
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    setUp()
  }

  deinit {
    controller.pauseEngine()
    controller.resetEngine()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    container.frame = bounds
    kakaoMap?.viewRect = bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    if window == nil {
      controller.pauseEngine()
    } else {
      ensureStarted()
      if isStarted {
        controller.activateEngine()
      }
    }
  }

  private var kakaoMap: KakaoMap? {
    controller.getView("mapview") as? KakaoMap
  }

  private func setUp() {
    addSubview(container)
    container.frame = bounds
    container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.delegate = self
    controller.clearDiskCache()
  }

  private func ensureStarted() {
    guard !isStarted else {
      return
    }

    guard let key = appKey as String?, !key.isEmpty else {
      return
    }

    if !Self.sdkInitializedKeys.contains(key) {
      SDKInitializer.InitSDK(appKey: key)
      Self.sdkInitializedKeys.insert(key)
    }

    isStarted = true
    controller.prepareEngine()
  }

  private func moveCamera() {
    guard let map = kakaoMap else {
      return
    }

    let update = CameraUpdate.make(
      target: MapPoint(longitude: cameraState.lng, latitude: cameraState.lat),
      zoomLevel: cameraState.zoomLevel,
      rotation: cameraState.rotation,
      tilt: cameraState.tilt,
      mapView: map
    )

    if cameraState.animationDuration > 0 {
      map.animateCamera(
        cameraUpdate: update,
        options: CameraAnimationOptions(
          autoElevation: true,
          consecutive: false,
          durationInMillis: UInt(cameraState.animationDuration)
        ),
        callback: {}
      )
    } else {
      map.moveCamera(cameraUpdate: update, callback: {})
    }
  }

  private func renderRoute() {
    guard let map = kakaoMap else {
      return
    }

    let manager = map.getRouteManager()
    let layer = manager.getRouteLayer(layerID: Constants.routeLayerID)
      ?? manager.addRouteLayer(layerID: Constants.routeLayerID, zOrder: 0)
    layer?.clearAllRoutes()

    let points = routeCoordinates.toMapPoints()
    guard points.count >= 2 else {
      return
    }

    if !routeStyleSetAdded {
      let styleSet = RouteStyleSet(styleID: Constants.routeStyleID)
      let style = RouteStyle()
      style.addPerLevelStyle(
        PerLevelRouteStyle(
          width: 10,
          color: UIColor(red: 46 / 255, green: 204 / 255, blue: 113 / 255, alpha: 1),
          strokeWidth: 3,
          strokeColor: .white,
          level: 0,
          patternIndex: -1
        )
      )
      styleSet.addStyle(style)
      manager.addRouteStyleSet(styleSet)
      routeStyleSetAdded = true
    }

    let segment = RouteSegment(points: points, styleIndex: 0)
    let route = layer?.addRoute(
      routeID: Constants.routeID,
      styleID: Constants.routeStyleID,
      zOrder: 0,
      segments: [segment]
    )
    route?.show()
  }

  private func renderCurrentLocation() {
    guard let map = kakaoMap else {
      return
    }

    guard
      let lat = currentLocation?.doubleValue(for: "latitude"),
      let lng = currentLocation?.doubleValue(for: "longitude")
    else {
      return
    }

    let manager = map.getLabelManager()
    let layer = manager.getLabelLayer(layerID: Constants.currentLocationLayerID)
      ?? manager.addLabelLayer(
        option: LabelLayerOptions(
          layerID: Constants.currentLocationLayerID,
          competitionType: .none,
          competitionUnit: .symbolFirst,
          orderType: .rank,
          zOrder: 1200
        )
      )
    layer?.clearAllItems()

    let iconStyle = PoiIconStyle(symbol: makeCurrentLocationImage(), anchorPoint: CGPoint(x: 0.5, y: 0.5))
    let poiStyle = PoiStyle(
      styleID: Constants.currentLocationStyleID,
      styles: [PerLevelPoiStyle(iconStyle: iconStyle, level: 0)]
    )
    manager.addPoiStyle(poiStyle)

    let options = PoiOptions(styleID: Constants.currentLocationStyleID, poiID: Constants.currentLocationPoiID)
    options.rank = 0
    options.clickable = false

    let poi = layer?.addPoi(
      option: options,
      at: MapPoint(longitude: lng, latitude: lat)
    )
    poi?.show()
  }

  private func renderPhotoMarkers() {
    guard let map = kakaoMap else {
      return
    }

    photoRenderVersion += 1
    let manager = map.getLabelManager()
    let layer = manager.getLabelLayer(layerID: Constants.photoLayerID)
      ?? manager.addLabelLayer(
        option: LabelLayerOptions(
          layerID: Constants.photoLayerID,
          competitionType: .none,
          competitionUnit: .symbolFirst,
          orderType: .rank,
          zOrder: 1100
        )
      )
    layer?.clearAllItems()

    guard let markers = photoMarkers as? [[String: Any]] else {
      return
    }

    for (index, marker) in markers.enumerated() {
      guard
        let lat = marker.doubleValue(for: "latitude"),
        let lng = marker.doubleValue(for: "longitude")
      else {
        continue
      }

      let markerID = marker.stringValue(for: "id") ?? "\(index)"
      let styleID = "hogyeong-photo-style-\(photoRenderVersion)-\(markerID)"
      let image = makePhotoMarkerImage(uri: marker.stringValue(for: "localUri") ?? marker.stringValue(for: "local_uri"))
      let iconStyle = PoiIconStyle(symbol: image, anchorPoint: CGPoint(x: 0.5, y: 0.5))
      let poiStyle = PoiStyle(
        styleID: styleID,
        styles: [PerLevelPoiStyle(iconStyle: iconStyle, level: 0)]
      )
      manager.addPoiStyle(poiStyle)

      let options = PoiOptions(styleID: styleID, poiID: "hogyeong-photo-\(markerID)")
      options.rank = Int32(index)
      options.clickable = false

      let poi = layer?.addPoi(
        option: options,
        at: MapPoint(longitude: lng, latitude: lat)
      )
      poi?.show()
    }
  }

  private func makeCurrentLocationImage() -> UIImage {
    let size = CGSize(width: 26, height: 26)
    let rect = CGRect(origin: .zero, size: size)
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      UIColor.white.setFill()
      context.cgContext.fillEllipse(in: rect)

      UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1).setFill()
      context.cgContext.fillEllipse(in: rect.insetBy(dx: 3, dy: 3))

      UIColor.white.withAlphaComponent(0.35).setFill()
      context.cgContext.fillEllipse(in: rect.insetBy(dx: 8, dy: 8))
    }
  }

  private func makePhotoMarkerImage(uri: String?) -> UIImage {
    let size = CGSize(width: 44, height: 44)
    let border: CGFloat = 2
    let rect = CGRect(origin: .zero, size: size)
    let renderer = UIGraphicsImageRenderer(size: size)

    return renderer.image { context in
      UIColor.white.setFill()
      context.cgContext.fillEllipse(in: rect)

      let innerRect = rect.insetBy(dx: border, dy: border)
      context.cgContext.saveGState()
      context.cgContext.addEllipse(in: innerRect)
      context.cgContext.clip()

      if let image = loadImage(uri: uri) {
        image.draw(in: innerRect)
      } else {
        UIColor(red: 46 / 255, green: 204 / 255, blue: 113 / 255, alpha: 1).setFill()
        context.cgContext.fillEllipse(in: innerRect)
      }

      context.cgContext.restoreGState()
    }
  }

  private func loadImage(uri: String?) -> UIImage? {
    guard let uri, !uri.isEmpty else {
      return nil
    }

    if uri.hasPrefix("file://"), let url = URL(string: uri) {
      return UIImage(contentsOfFile: url.path)
    }

    return UIImage(contentsOfFile: uri)
  }
}

extension HogyeongKakaoMapView: MapControllerDelegate {
  public func addViews() {
    let info = MapviewInfo(
      viewName: "mapview",
      appName: "openmap",
      viewInfoName: "map",
      defaultPosition: MapPoint(longitude: cameraState.lng, latitude: cameraState.lat),
      defaultLevel: cameraState.zoomLevel,
      enabled: true
    )
    controller.addView(info)
  }

  public func authenticationSucceeded() {
    if !controller.isEngineActive {
      controller.activateEngine()
    }
  }

  public func authenticationFailed(_ errorCode: Int, desc: String) {
    NSLog("[HogyeongKakaoMapView] authenticationFailed \(errorCode), \(desc)")
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
      self?.controller.prepareEngine()
    }
  }

  public func addViewSucceeded(_ viewName: String, viewInfoName: String) {
    guard viewName == "mapview" else {
      return
    }

    shouldForceInitialRender = true
    moveCamera()
    kakaoMap?.setPoiEnabled(true)
    kakaoMap?.setPoiClickable(true)
    kakaoMap?.showScaleBar()
    kakaoMap?.showCompass()
    renderRoute()
    renderCurrentLocation()
    renderPhotoMarkers()
    shouldForceInitialRender = false
  }

  public func addViewFailed(_ viewName: String, viewInfoName: String) {
    NSLog("[HogyeongKakaoMapView] addViewFailed \(viewName), \(viewInfoName)")
  }

  public func containerDidResized(_ size: CGSize) {
    kakaoMap?.viewRect = CGRect(origin: .zero, size: size)
  }

  public func viewWillDestroyed(_ view: ViewBase) {
    routeStyleSetAdded = false
  }
}

private struct CameraState {
  var lat = 37.5665
  var lng = 126.9780
  var zoomLevel = 15
  var rotation = 0.0
  var tilt = 0.0
  var animationDuration = 0.0

  init() {}

  init(dictionary: NSDictionary?) {
    guard let dictionary else {
      return
    }

    lat = dictionary.doubleValue(for: "lat") ?? lat
    lng = dictionary.doubleValue(for: "lng") ?? lng
    zoomLevel = dictionary.intValue(for: "zoomLevel") ?? zoomLevel
    rotation = dictionary.doubleValue(for: "rotation") ?? rotation
    tilt = dictionary.doubleValue(for: "tilt") ?? tilt
    animationDuration = dictionary.doubleValue(for: "animationDuration") ?? animationDuration
  }
}

private enum Constants {
  static let routeLayerID = "hogyeong-route-layer"
  static let routeStyleID = "hogyeong-route-style"
  static let routeID = "hogyeong-route"
  static let currentLocationLayerID = "hogyeong-current-location-layer"
  static let currentLocationStyleID = "hogyeong-current-location-style"
  static let currentLocationPoiID = "hogyeong-current-location"
  static let photoLayerID = "hogyeong-photo-layer"
}

private extension Optional where Wrapped == NSArray {
  func toMapPoints() -> [MapPoint] {
    guard let coordinates = self as? [[String: Any]] else {
      return []
    }

    return coordinates.compactMap { coordinate in
      guard
        let lat = coordinate.doubleValue(for: "latitude"),
        let lng = coordinate.doubleValue(for: "longitude")
      else {
        return nil
      }

      return MapPoint(longitude: lng, latitude: lat)
    }
  }
}

private extension NSDictionary {
  func doubleValue(for key: String) -> Double? {
    (self[key] as? NSNumber)?.doubleValue ?? self[key] as? Double
  }

  func intValue(for key: String) -> Int? {
    (self[key] as? NSNumber)?.intValue ?? self[key] as? Int
  }
}

private extension Dictionary where Key == String, Value == Any {
  func doubleValue(for key: String) -> Double? {
    (self[key] as? NSNumber)?.doubleValue ?? self[key] as? Double
  }

  func stringValue(for key: String) -> String? {
    self[key] as? String
  }
}
