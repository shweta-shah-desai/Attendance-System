import React from 'react';
import Svg, { Circle, Rect } from 'react-native-svg';

/**
 * Small Indian flag drawn with SVG rather than an emoji, because the emoji
 * flag does not render on most Android builds.
 */
export function IndiaFlag({ width = 22 }: { width?: number }) {
  const height = (width * 2) / 3;
  return (
    <Svg width={width} height={height} viewBox="0 0 30 20" accessibilityLabel="India">
      <Rect x="0" y="0" width="30" height="6.67" fill="#FF9933" />
      <Rect x="0" y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <Rect x="0" y="13.33" width="30" height="6.67" fill="#138808" />
      <Circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.7" />
      <Circle cx="15" cy="10" r="0.6" fill="#000080" />
      <Rect x="0" y="0" width="30" height="20" fill="none" stroke="#DCE3EC" strokeWidth="0.6" />
    </Svg>
  );
}
