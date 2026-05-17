import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { palette, radii, spacing, typography } from '../../theme';

interface Props extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string;
  containerStyle?: ViewStyle;
}

export function GlowInput({
  label,
  hint,
  error,
  containerStyle,
  style,
  onFocus,
  onBlur,
  multiline,
  ...rest
}: Readonly<Props>) {
  const [focused, setFocused] = useState(false);

  let footer: React.ReactNode = null;
  if (error) {
    footer = <Text style={[typography.label, styles.errorText]}>{error}</Text>;
  } else if (hint) {
    footer = <Text style={[typography.label, styles.hint]}>{hint}</Text>;
  }

  return (
    <View style={[styles.wrap, containerStyle]}>
      {label ? <Text style={[typography.label, styles.label]}>{label}</Text> : null}
      <TextInput
        {...rest}
        multiline={multiline}
        editable={rest.editable !== false}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        placeholderTextColor={palette.textDim}
        selectionColor={palette.accent}
        cursorColor={palette.accent}
        underlineColorAndroid="transparent"
        style={[
          styles.input,
          multiline && styles.inputMultiline,
          focused && styles.inputFocused,
          !!error && styles.inputError,
          style,
        ]}
      />
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%' },
  label: { color: palette.accent, marginBottom: spacing.xs },
  input: {
    width: '100%',
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 52,
    color: palette.text,
    fontSize: 16,
    fontWeight: '500',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  inputMultiline: {
    minHeight: 96,
    paddingTop: spacing.md,
    textAlignVertical: 'top',
  },
  inputFocused: {
    borderColor: palette.accent,
    shadowColor: palette.accent,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  inputError: { borderColor: palette.danger },
  hint: { color: palette.textDim, textTransform: 'none', letterSpacing: 0, marginTop: spacing.xs },
  errorText: { color: palette.danger, textTransform: 'none', letterSpacing: 0, marginTop: spacing.xs },
});
