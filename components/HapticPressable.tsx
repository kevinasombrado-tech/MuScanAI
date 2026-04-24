import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

type Props = PressableProps & {
  pressedOpacity?: number;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
};

const pressedStyle = (opacity: number): ViewStyle => ({ opacity });

export default function HapticPressable({
  onPress,
  style,
  disabled,
  pressedOpacity = 0.85,
  hapticStyle = Haptics.ImpactFeedbackStyle.Light,
  ...rest
}: Props) {
  const mergedStyle = (state: PressableStateCallbackType): StyleProp<ViewStyle> => {
    const base = typeof style === 'function' ? style(state) : style;
    return [base as StyleProp<ViewStyle>, state.pressed && !disabled ? pressedStyle(pressedOpacity) : null];
  };

  const handlePress: PressableProps['onPress'] = async (event) => {
    if (!disabled) {
      try {
        await Haptics.impactAsync(hapticStyle);
      } catch {
        // Ignore haptics errors on unsupported devices.
      }
    }
    onPress?.(event);
  };

  return <Pressable {...rest} disabled={disabled} style={mergedStyle} onPress={handlePress} />;
}
