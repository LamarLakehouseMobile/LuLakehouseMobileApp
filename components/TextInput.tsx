import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput as RNTextInput,
  Text,
  View,
  TextInputProps,
  TouchableOpacity,
} from 'react-native';

type Props = TextInputProps & {
  label: string;
  error?: string;
  showPasswordToggle?: boolean;
};

export default function TextInput({
  label,
  error,
  style,
  showPasswordToggle = false,
  secureTextEntry,
  ...props
}: Props) {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const shouldShowPasswordToggle = showPasswordToggle && secureTextEntry === true;
  const isSecure = secureTextEntry && !isPasswordVisible;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputContainer}>
        <RNTextInput
          style={[styles.input, style, shouldShowPasswordToggle && styles.inputWithToggle]}
          placeholderTextColor="#94A3B8"
          secureTextEntry={isSecure}
          {...props}
        />

        {shouldShowPasswordToggle && (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setIsPasswordVisible((current) => !current)}
            style={styles.toggleButton}
          >
            <Text style={styles.toggleText}>{isPasswordVisible ? 'Hide' : 'Show'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    marginBottom: 18,
  },
  label: {
    color: '#475569',
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  inputContainer: {
    position: 'relative',
    width: '100%',
  },
  input: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#0F172A',
  },
  inputWithToggle: {
    paddingRight: 72,
  },
  toggleButton: {
    position: 'absolute',
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  toggleText: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '700',
  },
  error: {
    marginTop: 6,
    color: '#EF4444',
    fontSize: 13,
  },
});
