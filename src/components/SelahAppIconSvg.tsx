import { Circle, G, Path, Svg } from 'react-native-svg';
import type { ColorValue } from 'react-native';

export interface SelahAppIconSvgProps {
  size?: number;
  color?: ColorValue;
}

export default function SelahAppIconSvg({ size = 24, color = '#26324A' }: SelahAppIconSvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M24 19c-5.4-3.5-11-4-17-1.7v20c6-2.3 11.6-1.8 17 1.7 5.4-3.5 11-4 17-1.7v-20C35 15 29.4 15.5 24 19Z" />
        <Path d="M24 19v20" />
      </G>
      <Path d="M31 16V31l3-2.2 3 2.2V15.4c-1.9-.2-3.9 0-6 .6Z" fill="#E8BD72" />
      <G stroke="#D5A94F" strokeWidth={1.6} strokeLinecap="round">
        <Path d="M24 3.5v4M16.5 7l2.2 3M31.5 7l-2.2 3M19 12.5l-2.4 1M29 12.5l2.4 1" />
      </G>
      <Circle cx="24" cy="11" r="1.4" fill="#E8BD72" />
    </Svg>
  );
}
