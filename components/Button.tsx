import React from 'react';
import { StyleSheet, Text, TouchableOpacity, TouchableOpacityProps, StyleProp, ViewStyle } from 'react-native';

type Props = TouchableOpacityProps & {
  title: string;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  style?: StyleProp<ViewStyle>;
};

export default function Button({
  title,
  loading,
  variant = 'primary',
  disabled,
  style,
  ...props
}: Props) {
  const buttonStyle = [
    styles.button,
    variant === 'ghost' ? styles.ghost : styles.primary,
    disabled && styles.disabled,
    style,
  ];

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={buttonStyle}
      disabled={disabled || loading}
      {...props}
    >
      <Text style={[styles.text, variant === 'ghost' && styles.ghostText]}>
        {loading ? 'Loading...' : title}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#FF3B30',
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#FF3B30',
  },
  disabled: {
    opacity: 0.65,
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  ghostText: {
    color: '#FF3B30',
  },
});
