import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { colors } from '../constants/colors';
import { radius, shadow, spacing, MIN_TOUCH } from '../constants/spacing';
import { typography } from '../constants/typography';

export interface SheetOption<T extends string> {
  value: T;
  label: string;
  /** Plain-language explanation shown under the option. */
  hint?: string;
  /** Optional leading MaterialCommunityIcons name. */
  icon?: string;
}

interface Props<T extends string> {
  visible: boolean;
  /** Sheet heading, e.g. "Wages Type" or "Sort by". */
  title: string;
  value: T;
  options: ReadonlyArray<SheetOption<T>>;
  onSelect: (value: T) => void;
  onClose: () => void;
}

/**
 * The single-choice modal sheet used by every picker in the app - form
 * dropdowns and the list sort menu - so they look and behave identically.
 */
export function OptionSheet<T extends string>({
  visible,
  title,
  value,
  options,
  onSelect,
  onClose,
}: Props<T>) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={styles.scrim}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={'Close ' + title}
      >
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView bounces={false}>
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    onSelect(opt.value);
                    onClose();
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.optionPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={opt.label}
                >
                  {opt.icon ? (
                    <MaterialCommunityIcons
                      name={opt.icon as never}
                      size={22}
                      color={active ? colors.primary : colors.textSecondary}
                    />
                  ) : null}
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                      {opt.label}
                    </Text>
                    {opt.hint ? <Text style={styles.optionHint}>{opt.hint}</Text> : null}
                  </View>
                  {active ? (
                    <MaterialCommunityIcons name="check" size={22} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    maxHeight: '70%',
    ...shadow.raised,
  },
  sheetTitle: {
    ...typography.h3,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  option: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  optionActive: { backgroundColor: colors.primaryTint },
  optionPressed: { backgroundColor: colors.background },
  optionText: { flex: 1 },
  optionLabel: typography.bodyStrong,
  optionLabelActive: { color: colors.primaryDark },
  optionHint: { ...typography.caption, fontSize: 12, marginTop: 1 },
});
