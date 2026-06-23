package com.quigmire1.hogyeongcrew.map

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.widget.FrameLayout
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.kakao.vectormap.KakaoMap
import com.kakao.vectormap.KakaoMapReadyCallback
import com.kakao.vectormap.KakaoMapSdk
import com.kakao.vectormap.LatLng
import com.kakao.vectormap.MapLifeCycleCallback
import com.kakao.vectormap.MapView
import com.kakao.vectormap.camera.CameraAnimation
import com.kakao.vectormap.camera.CameraUpdateFactory
import com.kakao.vectormap.label.CompetitionType
import com.kakao.vectormap.label.LabelLayer
import com.kakao.vectormap.label.LabelLayerOptions
import com.kakao.vectormap.label.LabelOptions
import com.kakao.vectormap.label.LabelStyle
import com.kakao.vectormap.route.RouteLineOptions
import com.kakao.vectormap.route.RouteLineSegment
import com.kakao.vectormap.route.RouteLineStyle
import java.io.File

class HogyeongKakaoMapView(context: Context) : FrameLayout(context) {
  private val mapView = MapView(context)
  private var kakaoMap: KakaoMap? = null
  private var started = false
  private var sdkInitialized = false
  private var appKey: String? = null
  private var camera = CameraState()
  private var currentLocation: ReadableMap? = null
  private var routeCoordinates: ReadableArray? = null
  private var photoMarkers: ReadableArray? = null

  init {
    addView(mapView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setAppKey(value: String?) {
    appKey = value?.takeIf { it.isNotBlank() }
    ensureStarted()
  }

  fun setCamera(value: ReadableMap?) {
    camera = CameraState.fromReadableMap(value)
    kakaoMap?.moveCamera(
      CameraUpdateFactory.newCenterPosition(LatLng.from(camera.lat, camera.lng), camera.zoomLevel),
      CameraAnimation.from(camera.animationDuration),
    )
  }

  fun setCurrentLocation(value: ReadableMap?) {
    currentLocation = value
    renderCurrentLocation()
  }

  fun setRouteCoordinates(value: ReadableArray?) {
    routeCoordinates = value
    renderRoute()
  }

  fun setPhotoMarkers(value: ReadableArray?) {
    photoMarkers = value
    renderPhotoMarkers()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ensureStarted()
    mapView.resume()
  }

  override fun onDetachedFromWindow() {
    mapView.pause()
    super.onDetachedFromWindow()
  }

  private fun ensureStarted() {
    if (started || appKey.isNullOrBlank()) return

    if (!sdkInitialized) {
      KakaoMapSdk.init(context.applicationContext, appKey!!)
      sdkInitialized = true
    }

    started = true
    mapView.start(
      object : MapLifeCycleCallback() {
        override fun onMapDestroy() {
          kakaoMap = null
          started = false
        }

        override fun onMapError(error: Exception) {
          kakaoMap = null
        }
      },
      object : KakaoMapReadyCallback() {
        override fun getPosition(): LatLng = LatLng.from(camera.lat, camera.lng)

        override fun getZoomLevel(): Int = camera.zoomLevel

        override fun onMapReady(map: KakaoMap) {
          kakaoMap = map
          map.isPoiVisible = true
          map.isPoiClickable = true
          map.scaleBar?.show()
          map.compass?.show()
          renderCurrentLocation()
          renderRoute()
          renderPhotoMarkers()
        }
      },
    )
  }

  private fun renderCurrentLocation() {
    val map = kakaoMap ?: return
    val location = currentLocation ?: return
    val lat = location.getOptionalDouble("latitude") ?: return
    val lng = location.getOptionalDouble("longitude") ?: return
    val layer = getCurrentLocationLayer(map)

    layer.removeAll()

    val style = LabelStyle.from(createCurrentLocationBitmap()).setAnchorPoint(0.5f, 0.5f)
    val options = LabelOptions
      .from(CURRENT_LOCATION_LABEL_ID, LatLng.from(lat, lng))
      .setStyles(style)
      .setRank(0)
      .setClickable(false)

    layer.addLabel(options)
  }

  private fun renderRoute() {
    val map = kakaoMap ?: return
    val routeLineManager = map.routeLineManager ?: return
    val points = routeCoordinates.toLatLngList()

    routeLineManager.clearAll()

    if (points.size < 2) return

    val style = RouteLineStyle.from(
      10f,
      Color.rgb(46, 204, 113),
      3f,
      Color.WHITE,
    )
    val segment = RouteLineSegment.from(points, style)
    val options = RouteLineOptions.from("hogyeong-route", segment).setZOrder(1000)
    routeLineManager.addLayer("hogyeong-route-layer", 1000).addRouteLine(options)
  }

  private fun getCurrentLocationLayer(map: KakaoMap): LabelLayer {
    val labelManager = map.labelManager ?: error("Kakao label manager is unavailable.")
    val existing = labelManager.getLayer(CURRENT_LOCATION_LAYER_ID)
    if (existing != null) return existing

    return labelManager.addLayer(
      LabelLayerOptions
        .from(CURRENT_LOCATION_LAYER_ID)
        .setZOrder(1200)
        .setCompetitionType(CompetitionType.None)
        .setClickable(false),
    ) ?: error("Kakao current location label layer could not be created.")
  }

  private fun renderPhotoMarkers() {
    val map = kakaoMap ?: return
    val markers = photoMarkers ?: return
    val layer = getPhotoLayer(map)

    layer.removeAll()

    for (index in 0 until markers.size()) {
      val marker = markers.getMap(index) ?: continue
      val lat = marker.getOptionalDouble("latitude") ?: continue
      val lng = marker.getOptionalDouble("longitude") ?: continue
      val uri = marker.getOptionalString("localUri") ?: marker.getOptionalString("local_uri")
      val id = marker.getOptionalString("id") ?: index.toString()
      val icon = createPhotoMarkerBitmap(uri)
      val style = LabelStyle.from(icon).setAnchorPoint(0.5f, 0.5f)
      val options = LabelOptions
        .from("hogyeong-photo-$id", LatLng.from(lat, lng))
        .setStyles(style)
        .setRank(index.toLong())
        .setClickable(false)

      layer.addLabel(options)
    }
  }

  private fun getPhotoLayer(map: KakaoMap): LabelLayer {
    val labelManager = map.labelManager ?: error("Kakao label manager is unavailable.")
    val existing = labelManager.getLayer(PHOTO_LAYER_ID)
    if (existing != null) return existing

    return labelManager.addLayer(
      LabelLayerOptions
        .from(PHOTO_LAYER_ID)
        .setZOrder(1100)
        .setCompetitionType(CompetitionType.None)
        .setClickable(false),
    ) ?: error("Kakao photo label layer could not be created.")
  }

  private fun ReadableArray?.toLatLngList(): List<LatLng> {
    if (this == null) return emptyList()

    val points = mutableListOf<LatLng>()
    for (index in 0 until size()) {
      val coordinate = getMap(index) ?: continue
      val lat = coordinate.getOptionalDouble("latitude") ?: continue
      val lng = coordinate.getOptionalDouble("longitude") ?: continue
      points.add(LatLng.from(lat, lng))
    }

    return points
  }

  private fun createCurrentLocationBitmap(): Bitmap {
    val size = dp(16)
    val ring = dp(2).toFloat()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val center = size / 2f

    paint.color = Color.WHITE
    canvas.drawCircle(center, center, center, paint)

    paint.color = Color.rgb(37, 99, 235)
    canvas.drawCircle(center, center, center - ring, paint)

    paint.color = Color.argb(42, 37, 99, 235)
    canvas.drawCircle(center, center, center - ring / 2f, paint)

    paint.color = Color.rgb(37, 99, 235)
    canvas.drawCircle(center, center, dp(4).toFloat(), paint)

    return bitmap
  }

  private fun createPhotoMarkerBitmap(uri: String?): Bitmap {
    val source = loadBitmap(uri)
    val size = dp(44)
    val border = dp(2).toFloat()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)

    paint.color = Color.WHITE
    canvas.drawCircle(size / 2f, size / 2f, size / 2f, paint)

    val innerRadius = size / 2f - border
    val path = Path().apply {
      addCircle(size / 2f, size / 2f, innerRadius, Path.Direction.CW)
    }

    canvas.save()
    canvas.clipPath(path)

    if (source != null) {
      val scaled = Bitmap.createScaledBitmap(source, size, size, true)
      canvas.drawBitmap(scaled, 0f, 0f, paint)
      if (scaled !== source) scaled.recycle()
    } else {
      paint.color = Color.rgb(46, 204, 113)
      canvas.drawCircle(size / 2f, size / 2f, innerRadius, paint)
    }

    canvas.restore()
    source?.recycle()

    return bitmap
  }

  private fun loadBitmap(uri: String?): Bitmap? {
    if (uri.isNullOrBlank()) return null

    return try {
      val parsed = Uri.parse(uri)
      when (parsed.scheme) {
        "content", "file" -> context.contentResolver.openInputStream(parsed)?.use(BitmapFactory::decodeStream)
        null, "" -> BitmapFactory.decodeFile(uri)
        else -> BitmapFactory.decodeFile(File(uri).absolutePath)
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun ReadableMap.getOptionalDouble(key: String): Double? =
    if (hasKey(key) && !isNull(key)) getDouble(key) else null

  private fun ReadableMap.getOptionalString(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private data class CameraState(
    val lat: Double = 37.5665,
    val lng: Double = 126.9780,
    val zoomLevel: Int = 15,
    val animationDuration: Int = 0,
  ) {
    companion object {
      fun fromReadableMap(value: ReadableMap?): CameraState {
        if (value == null) return CameraState()

        return CameraState(
          lat = getOptionalDouble(value, "lat") ?: getOptionalDouble(value, "latitude") ?: 37.5665,
          lng = getOptionalDouble(value, "lng") ?: getOptionalDouble(value, "longitude") ?: 126.9780,
          zoomLevel = (getOptionalDouble(value, "zoomLevel") ?: 15.0).toInt(),
          animationDuration = (getOptionalDouble(value, "animationDuration") ?: 0.0).toInt(),
        )
      }

      private fun getOptionalDouble(value: ReadableMap, key: String): Double? =
        if (value.hasKey(key) && !value.isNull(key)) value.getDouble(key) else null
    }
  }

  companion object {
    private const val CURRENT_LOCATION_LAYER_ID = "hogyeong-current-location-layer"
    private const val CURRENT_LOCATION_LABEL_ID = "hogyeong-current-location"
    private const val PHOTO_LAYER_ID = "hogyeong-photo-layer"
  }
}
