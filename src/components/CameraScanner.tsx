/**
 * CameraScanner — Camera capture component for medicine strip scanning.
 *
 * Features:
 *   - Front / back camera toggle
 *   - Capture photo → returns base64 for OCR processing
 *   - Haptic feedback on capture
 *   - Responsive: full-screen modal on phone, inline pane on tablet
 */

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
import { CameraView, useCameraPermissions, type CameraType } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { COLORS, FONT, SPACING, RADIUS, TOUCH_TARGET_MIN } from '../constants/theme';
import { PrimaryButton } from './PrimaryButton';

// ─── Props ──────────────────────────────────────────────────────────

interface CameraScannerProps {
  /** Called when a photo is captured. Receives the local file URI and base64 data. */
  onCapture: (uri: string, base64: string) => void;
  /** Called when the user dismisses the camera (phone modal mode). */
  onClose: () => void;
  /** Whether to render as a full-screen modal (phone) or inline (tablet). */
  modal?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────

export function CameraScanner({ onCapture, onClose, modal = false }: CameraScannerProps) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [capturing, setCapturing] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewBase64, setPreviewBase64] = useState<string | null>(null);

  // ── Toggle front / back camera
  const toggleFacing = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  // ── Take photo
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: true,
        skipProcessing: true,
      });

      if (photo) {
        setPreviewUri(photo.uri);
        setPreviewBase64(photo.base64 ?? null);
      }
    } catch (err) {
      console.error('Camera capture error:', err);
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  // ── Confirm the captured photo
  const handleConfirm = useCallback(() => {
    if (previewUri && previewBase64) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCapture(previewUri, previewBase64);
      setPreviewUri(null);
      setPreviewBase64(null);
    }
  }, [previewUri, previewBase64, onCapture]);

  // ── Retake photo
  const handleRetake = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPreviewUri(null);
    setPreviewBase64(null);
  }, []);

  // ── Permission states
  if (!permission) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!permission.granted) {
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

  // ── Camera / Preview content
  const content = (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.topBar}>
        <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={16}>
          <Text style={styles.closeBtnText}>✕</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>
          {previewUri ? 'Preview' : 'Scan Medicine Strip'}
        </Text>
        <View style={styles.closeBtn} />
      </View>

      {/* Camera view or photo preview */}
      {previewUri ? (
        <View style={styles.previewWrap}>
          <Image
            source={{ uri: previewUri }}
            style={styles.previewImage}
            resizeMode="contain"
          />
        </View>
      ) : (
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
        >
          {/* Viewfinder overlay */}
          <View style={styles.viewfinder}>
            <View style={styles.viewfinderCornerTL} />
            <View style={styles.viewfinderCornerTR} />
            <View style={styles.viewfinderCornerBL} />
            <View style={styles.viewfinderCornerBR} />
          </View>
          <Text style={styles.viewfinderHint}>
            Align medicine strip text within the frame
          </Text>
        </CameraView>
      )}

      {/* Bottom controls */}
      <View style={styles.bottomBar}>
        {previewUri ? (
          <>
            <PrimaryButton
              label="↻ Retake"
              onPress={handleRetake}
              variant="ghost"
              style={styles.actionBtn}
            />
            <PrimaryButton
              label="✓ Use Photo"
              onPress={handleConfirm}
              style={styles.actionBtn}
            />
          </>
        ) : (
          <>
            <Pressable onPress={toggleFacing} style={styles.flipBtn}>
              <Text style={styles.flipBtnText}>🔄</Text>
              <Text style={styles.flipBtnLabel}>
                {facing === 'back' ? 'Front' : 'Back'}
              </Text>
            </Pressable>

            {/* Shutter button */}
            <Pressable
              onPress={handleCapture}
              disabled={capturing}
              style={({ pressed }) => [
                styles.shutterBtn,
                pressed && styles.shutterBtnPressed,
              ]}
            >
              {capturing ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </Pressable>

            <View style={styles.flipBtn} />
          </>
        )}
      </View>
    </View>
  );

  // ── Render as modal or inline
  if (modal) {
    return (
      <Modal
        visible
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={onClose}
      >
        {content}
      </Modal>
    );
  }

  return content;
}

// ─── Viewfinder corner helper ───────────────────────────────────────

const CORNER_SIZE = 32;
const CORNER_WIDTH = 4;
const cornerBase = {
  position: 'absolute' as const,
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  borderColor: COLORS.primary,
};

// ─── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bg,
  },

  // Permission
  permissionBox: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  permissionTitle: {
    fontSize: FONT.large,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.md,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: FONT.base,
    color: COLORS.textDim,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 26,
  },
  permissionBtn: {
    marginTop: SPACING.md,
    minWidth: 260,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  topBarTitle: {
    fontSize: FONT.medium,
    fontWeight: '700',
    color: COLORS.text,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: FONT.large,
    color: COLORS.text,
    fontWeight: '700',
  },

  // Camera
  camera: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  // Viewfinder overlay
  viewfinder: {
    position: 'absolute',
    top: '20%',
    left: '10%',
    right: '10%',
    bottom: '30%',
  },
  viewfinderCornerTL: {
    ...cornerBase,
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: RADIUS.md,
  },
  viewfinderCornerTR: {
    ...cornerBase,
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: RADIUS.md,
  },
  viewfinderCornerBL: {
    ...cornerBase,
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: RADIUS.md,
  },
  viewfinderCornerBR: {
    ...cornerBase,
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: RADIUS.md,
  },
  viewfinderHint: {
    fontSize: FONT.base,
    color: 'rgba(255,255,255,0.8)',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    marginBottom: SPACING.xl,
    overflow: 'hidden',
  },

  // Preview
  previewWrap: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionBtn: {
    flex: 1,
    marginHorizontal: SPACING.sm,
  },

  // Flip button
  flipBtn: {
    width: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBtnText: {
    fontSize: 24,
  },
  flipBtnLabel: {
    fontSize: 13,
    color: COLORS.textDim,
    marginTop: 2,
    fontWeight: '600',
  },

  // Shutter button
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  shutterBtnPressed: {
    transform: [{ scale: 0.92 }],
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.primary,
  },
});
