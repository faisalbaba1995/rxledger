import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { useCameraDevice, useCameraPermission, Camera as BaseCamera } from 'react-native-vision-camera';
import { Camera } from 'react-native-vision-camera-ocr-plus';
import type { Text as OCRText } from 'react-native-vision-camera-ocr-plus/lib/typescript/src/types';

import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { COLORS, FONT, SPACING, RADIUS } from '../constants/theme';
import { PrimaryButton } from './PrimaryButton';

export interface CapturedImage {
  uri: string;
  base64: string;
}

interface CameraScannerProps {
  onCapture: (uris: string[], base64s: string[]) => void;
  onClose: () => void;
  modal?: boolean;
}

export function CameraScanner({ onCapture, onClose, modal = false }: CameraScannerProps) {
  const cameraRef = useRef<React.ElementRef<typeof BaseCamera>>(null);
  const { hasPermission, requestPermission } = useCameraPermission();
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const device = useCameraDevice(facing);
  
  const [capturing, setCapturing] = useState(false);
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);

  const toggleFacing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing || images.length >= 2) return;

    setCapturing(true);
    // Added shutter sound/haptic
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      const photo = await (cameraRef.current as any).takePhoto({
        qualityPrioritization: 'speed',
        enableShutterSound: true,
      });

      if (photo) {
        // Downscale image to dramatically reduce base64 payload size
        const manipResult = await ImageManipulator.manipulateAsync(
          `file://${photo.path}`,
          [{ resize: { width: 1024 } }],
          { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
        );

        setImages(prev => {
          const newImages = [...prev, { uri: manipResult.uri, base64: manipResult.base64 ?? '' }];
          if (newImages.length >= 2) {
             setAutoCaptureEnabled(false);
          }
          return newImages;
        });
      }
    } catch (err) {
      console.error('Camera capture error:', err);
    } finally {
      setCapturing(false);
    }
  }, [capturing, images.length]);

  const triggerCapture = useCallback(async () => {
    if (autoCaptureEnabled && !capturing && images.length < 2) {
      console.log('Auto-capturing due to high text density!');
      setAutoCaptureEnabled(false);
      await handleCapture();
      // Re-enable auto capture after a delay if we still need more images
      setTimeout(() => {
        setAutoCaptureEnabled(true);
      }, 2000);
    }
  }, [autoCaptureEnabled, capturing, images.length, handleCapture]);

  const handleTextRecognized = useCallback((data: string | OCRText) => {
    if (!autoCaptureEnabled) return;
    
    const textData = data as OCRText;
    if (textData && textData.resultText) {
       if (textData.resultText.length > 40) {
          triggerCapture();
       }
    }
  }, [autoCaptureEnabled, triggerCapture]);

  const handleRemoveImage = useCallback((index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setImages(prev => {
      const newImages = prev.filter((_, i) => i !== index);
      if (newImages.length < 2) {
        setAutoCaptureEnabled(true);
      }
      return newImages;
    });
  }, []);

  const handleProcess = useCallback(() => {
    if (images.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      onCapture(
        images.map(img => img.uri),
        images.map(img => img.base64)
      );
    }
  }, [images, onCapture]);

  if (hasPermission === null) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={styles.permissionBox}>
        <Text style={styles.permissionTitle}>📷 Camera Access Required</Text>
        <Text style={styles.permissionText}>
          We need camera access to scan medicine strips and auto-fill batch info.
        </Text>
        <PrimaryButton
          label="Grant Camera Permission"
          onPress={requestPermission}
          style={styles.permissionBtn}
        />
        <PrimaryButton
          label="Cancel"
          onPress={onClose}
          variant="ghost"
          style={styles.permissionBtn}
        />
      </View>
    );
  }

  const content = (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.topBar}>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={16}>
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>
          Scan Medicine ({images.length}/2)
        </Text>
        <View style={styles.closeBtn} />
      </View>

      {/* Camera view */}
      <View style={styles.cameraWrap}>
        {!!device ? (
          <Camera
            ref={cameraRef}
            // @ts-ignore - The plugin's wrapper doesn't type 'style' properly
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={true}
            photo={true}
            mode="recognize"
            options={{ language: 'latin' }}
            callback={handleTextRecognized}
          />
        ) : (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={{color: COLORS.textDim, marginTop: SPACING.md}}>Initializing Camera...</Text>
          </View>
        )}
        <View style={[StyleSheet.absoluteFill, styles.viewfinderOverlay]} pointerEvents="none">
          <View style={styles.viewfinder}>
            <View style={styles.viewfinderCornerTL} />
            <View style={styles.viewfinderCornerTR} />
            <View style={styles.viewfinderCornerBL} />
            <View style={styles.viewfinderCornerBR} />
          </View>
          <Text style={styles.viewfinderHint}>
            {images.length === 0 
              ? 'Scan Front or Back (Auto-Captures Text)' 
              : images.length === 1 
                ? 'Scan other side or Analyze now' 
                : 'Maximum 2 photos reached'}
          </Text>
        </View>
      </View>

      {/* Bottom section */}
      <View style={styles.bottomSection}>
        {/* Thumbnails row */}
        {images.length > 0 && (
          <View style={styles.thumbnailRow}>
            {images.map((img, index) => (
              <View key={index} style={styles.thumbnailWrap}>
                <Image source={{ uri: img.uri }} style={styles.thumbnail} />
                <Pressable style={styles.removeBtn} onPress={() => handleRemoveImage(index)}>
                  <Text style={styles.removeBtnText}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        {/* Controls row */}
        <View style={styles.controlsRow}>
          <Pressable onPress={toggleFacing} style={styles.sideBtn}>
            <Text style={styles.sideBtnText}>🔄</Text>
            <Text style={styles.sideBtnLabel}>Flip</Text>
          </Pressable>

          <Pressable
            onPress={handleCapture}
            disabled={capturing || images.length >= 2}
            style={({ pressed }) => [
              styles.shutterBtn,
              pressed && styles.shutterBtnPressed,
              images.length >= 2 && { opacity: 0.5 },
            ]}
          >
            {capturing ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <View style={styles.shutterInner} />
            )}
          </Pressable>

          {images.length > 0 ? (
            <Pressable onPress={handleProcess} style={styles.processBtn}>
              <Text style={styles.processBtnText}>Analyze</Text>
              <Text style={styles.processBtnCount}>({images.length})</Text>
            </Pressable>
          ) : (
            <View style={styles.sideBtn} /> // placeholder to center shutter
          )}
        </View>
      </View>
    </View>
  );

  if (modal) {
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        {content}
      </Modal>
    );
  }

  return content;
}

const CORNER_SIZE = 32;
const CORNER_WIDTH = 4;
const cornerBase = {
  position: 'absolute' as const,
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  borderColor: COLORS.primary,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg },
  
  permissionBox: {
    flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl,
  },
  permissionTitle: { fontSize: FONT.large, fontWeight: '700', color: COLORS.text, marginBottom: SPACING.md, textAlign: 'center' },
  permissionText: { fontSize: FONT.base, color: COLORS.textDim, textAlign: 'center', marginBottom: SPACING.xl, lineHeight: 26 },
  permissionBtn: { marginTop: SPACING.md, minWidth: 260 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, 
    backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  topBarTitle: { fontSize: FONT.medium, fontWeight: '700', color: COLORS.text },
  closeBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: FONT.large, color: COLORS.text, fontWeight: '700' },

  cameraWrap: { flex: 1, position: 'relative' },
  viewfinderOverlay: { justifyContent: 'flex-end', alignItems: 'center' },
  viewfinder: { position: 'absolute', top: '20%', left: '10%', right: '10%', bottom: '30%' },
  
  viewfinderCornerTL: { ...cornerBase, top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderTopLeftRadius: RADIUS.md },
  viewfinderCornerTR: { ...cornerBase, top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderTopRightRadius: RADIUS.md },
  viewfinderCornerBL: { ...cornerBase, bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderBottomLeftRadius: RADIUS.md },
  viewfinderCornerBR: { ...cornerBase, bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderBottomRightRadius: RADIUS.md },
  
  viewfinderHint: {
    fontSize: FONT.base, color: 'rgba(255,255,255,0.9)', textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm, marginBottom: SPACING.xl, overflow: 'hidden',
  },

  bottomSection: {
    backgroundColor: COLORS.surface,
    paddingBottom: SPACING.xl,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  
  thumbnailRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  thumbnailWrap: {
    width: 60,
    height: 80,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
    position: 'relative',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: RADIUS.sm,
    opacity: 0.8,
  },
  removeBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: COLORS.danger,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.surface,
  },
  removeBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.xl,
  },
  
  sideBtn: { width: 80, alignItems: 'center', justifyContent: 'center' },
  sideBtnText: { fontSize: 24 },
  sideBtnLabel: { fontSize: 13, color: COLORS.textDim, marginTop: 2, fontWeight: '600' },

  processBtn: {
    width: 80,
    height: 48,
    backgroundColor: COLORS.primary,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  processBtnText: { color: COLORS.bg, fontSize: 14, fontWeight: 'bold' },
  processBtnCount: { color: COLORS.bg, fontSize: 12, fontWeight: '600' },

  shutterBtn: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: COLORS.primary,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent',
  },
  shutterBtnPressed: { transform: [{ scale: 0.92 }] },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: COLORS.primary },
});
