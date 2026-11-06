import { Circle, G, Path, Svg } from 'react-native-svg';
import type { ColorValue } from 'react-native';

export interface SelahAppIconSvgProps {
  size?: number;
  color?: ColorValue;
}

/**
 * Sunburst open-Bible app motif, symmetrical around x = 12 (viewBox 0 0 24 24).
 *
 * - Open Bible pages (filled #7C9BFF) mirrored left/right of the spine.
 * - Golden ribbon bookmark (#F5C469) on the right page.
 * - Sun dot + five radiance rays (#F5C469) crowning the book.
 *
 * `color` tints the centre spine line (defaults to the page blue) so callers
 * can keep the mark on-theme.
 */
export default function SelahAppIconSvg({ size = 24, color = '#7C9BFF' }: SelahAppIconSvgProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Sunburst rays — five strokes mirrored around x = 12 */}
      <G stroke="#F5C469" strokeWidth={1.1} strokeLinecap="round">
        <Path d="M12 3.3 V1.6" />
        <Path d="M10.4 3.8 L9.3 2.4" />
        <Path d="M13.6 3.8 L14.7 2.4" />
        <Path d="M9.4 5.1 L7.8 4.5" />
        <Path d="M14.6 5.1 L16.2 4.5" />
      </G>
      {/* Sun dot */}
      <Circle cx={12} cy={5.0} r={0.95} fill="#F5C469" />
      {/* Open Bible pages, mirrored around x = 12 */}
      <G fill="#7C9BFF">
        <Path d="M12 7.5 C9.5 6.2 6.2 6.2 3.5 7.2 V18.5 C6.2 17.5 9.5 17.5 12 18.8 Z" />
        <Path d="M12 7.5 C14.5 6.2 17.8 6.2 20.5 7.2 V18.5 C17.8 17.5 14.5 17.5 12 18.8 Z" />
      </G>
      {/* Centre spine */}
      <Path d="M12 7.5 V18.8" stroke={color} strokeWidth={0.9} strokeLinecap="round" />
      {/* Golden ribbon bookmark */}
      <Path d="M15.2 6.7 H17.6 V15.2 L16.4 13.8 L15.2 15.2 Z" fill="#F5C469" />
    </Svg>
  );
}
