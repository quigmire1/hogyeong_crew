import { FontAwesome } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Image,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export type GalleryPhoto = {
  id: string;
  uri: string;
};

type PhotoLightboxProps = {
  photo?: GalleryPhoto | null;
  photos?: GalleryPhoto[];
  initialIndex?: number;
  visible?: boolean;
  onClose: () => void;
};

const { width: screenWidth } = Dimensions.get('window');

export function PhotoLightbox({
  photo,
  photos,
  initialIndex = 0,
  visible,
  onClose,
}: PhotoLightboxProps) {
  const scrollRef = useRef<ScrollView>(null);
  const galleryPhotos = useMemo(
    () => (photos?.length ? photos : photo ? [photo] : []),
    [photo, photos],
  );
  const isVisible = visible ?? Boolean(photo);
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    if (!isVisible || galleryPhotos.length === 0) return;

    const nextIndex = Math.min(Math.max(initialIndex, 0), galleryPhotos.length - 1);
    setCurrentIndex(nextIndex);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: nextIndex * screenWidth, animated: false });
    });
  }, [galleryPhotos.length, initialIndex, isVisible]);

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / screenWidth);
    setCurrentIndex(Math.min(Math.max(nextIndex, 0), galleryPhotos.length - 1));
  };

  return (
    <Modal visible={isVisible && galleryPhotos.length > 0} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.lightboxOverlay}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.85}>
          <FontAwesome name="close" size={18} color="#FFF" />
        </TouchableOpacity>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          style={styles.lightboxScroll}
        >
          {galleryPhotos.map((galleryPhoto) => (
            <View key={galleryPhoto.id} style={styles.fullImagePage}>
              <Image source={{ uri: galleryPhoto.uri }} style={styles.fullImage} resizeMode="contain" />
            </View>
          ))}
        </ScrollView>
        {galleryPhotos.length > 1 ? (
          <Text style={styles.photoCounter}>
            {currentIndex + 1} / {galleryPhotos.length}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

type PhotoGalleryModalProps = {
  photos: GalleryPhoto[];
  visible: boolean;
  title?: string;
  onClose: () => void;
  onSelectPhoto: (photo: GalleryPhoto) => void;
};

export function PhotoGalleryModal({
  photos,
  visible,
  title = '사진',
  onClose,
  onSelectPhoto,
}: PhotoGalleryModalProps) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.galleryOverlay}>
        <View style={styles.gallerySheet}>
          <View style={styles.galleryHeader}>
            <Text style={styles.galleryTitle}>{title}</Text>
            <TouchableOpacity style={styles.galleryCloseButton} onPress={onClose} activeOpacity={0.85}>
              <FontAwesome name="close" size={16} color="#333" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.galleryGrid} showsVerticalScrollIndicator={false}>
            {photos.map((photo) => (
              <TouchableOpacity
                key={photo.id}
                style={styles.galleryThumbButton}
                onPress={() => onSelectPhoto(photo)}
                activeOpacity={0.85}
              >
                <Image source={{ uri: photo.uri }} style={styles.galleryThumb} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  lightboxOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 54,
    right: 22,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxScroll: {
    width: '100%',
  },
  fullImagePage: {
    width: screenWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: '100%',
    height: '82%',
  },
  photoCounter: {
    position: 'absolute',
    bottom: 46,
    alignSelf: 'center',
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  galleryOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  gallerySheet: {
    maxHeight: '78%',
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  galleryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  galleryTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#111',
  },
  galleryCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F3F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  galleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    paddingBottom: 12,
  },
  galleryThumbButton: {
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#E8EDF2',
  },
  galleryThumb: {
    width: '100%',
    height: '100%',
  },
});
