import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { radius, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';
import { OptionSheet, type SheetOption } from './OptionSheet';

/** A dropdown entry is just a sheet option. */
export type DropdownOption<T extends string> = SheetOption<T>;

interface Props<T extends string> {
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  /** Accessibility label / sheet title, e.g. "Wages Type". */
  title: string;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** Shorter box for toolbars, where the dropdown sits beside a heading. */
  compact?: boolean;
}

/**
 * Value picker used wherever the spec says "drop down menu".
 *
 * The options are shown in a modal sheet instead of a free-text box, so a value
 * outside the allowed list can never reach the form - that is what "validate
 * entry against ..." asks for.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  title,
  placeholder = 'Select',
  invalid,
  disabled,
  compact,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={({ pressed }) => [
          styles.box,
          compact && styles.boxCompact,
          invalid && styles.boxError,
          pressed && styles.boxPressed,
          disabled && styles.boxDisabled,
        ]}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
      >
        <Text
          style={[styles.value, compact && styles.valueCompact, !selected && styles.placeholder]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={compact ? 20 : 24}
          color={colors.textSecondary}
        />
      </Pressable>

      <OptionSheet
        visible={open}
        title={title}
        value={value}
        options={options}
        onSelect={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  boxCompact: { minHeight: 42, gap: spacing.xs, paddingHorizontal: spacing.sm },
  boxError: { borderColor: colors.error },
  boxPressed: { backgroundColor: colors.primaryTint },
  boxDisabled: { opacity: 0.6 },
  value: { ...typography.body, flex: 1 },
  valueCompact: { fontSize: 14, fontWeight: '600' },
  placeholder: { color: colors.textDisabled },
});
