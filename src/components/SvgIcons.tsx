/**
 * Custom minimal vector illustrations used across the app.
 *
 * All icons render on a 24x24 viewBox using only `react-native-svg`
 * primitives (`Svg`, `Path`, `Circle`, `Rect`, `G`). Every icon accepts a
 * `size` and a primary `color` so screens can theme them via the palette.
 */

import { Svg, Path, Circle, Rect, G } from 'react-native-svg';
import type { ColorValue } from 'react-native';

export interface SvgIconProps {
  /** Rendered square size in dp (default 24). */
  size?: number;
  /** Primary stroke/fill color — falls back to a neutral gray. */
  color?: string;
}

interface StrokeIconProps extends SvgIconProps {
  strokeWidth?: number;
}

const DEFAULT_COLOR = '#8B95A5';

function StrokeSvg({
  size = 24,
  color = DEFAULT_COLOR,
  strokeWidth = 1.6,
  children,
}: StrokeIconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </G>
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// BibleBookSvg — closed book with a spine and a cross on the cover
// ---------------------------------------------------------------------------

export function BibleBookSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M4.5 19.5V5.5A2.5 2.5 0 0 1 7 3h11.5a1 1 0 0 1 1 1v13" />
      <Path d="M4.5 19.5A2.5 2.5 0 0 1 7 17h12.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1H7a2.5 2.5 0 0 1-2.5-2.5Z" />
      <Path d="M11.25 7v5M9 9.5h4.5" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// EmptyHighlightsSvg — page lines with a highlighter marker
// ---------------------------------------------------------------------------

export function EmptyHighlightsSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M4 5.5h9M4 9.5h7M4 13.5h6" />
      <Rect x="3.5" y="16.5" width="8" height="4" rx="1" />
      <Path d="M14.5 17.5l4-4 2.4 2.4-4 4z" />
      <Path d="M17.2 12l2-2a1.6 1.6 0 0 1 2.3 2.3l-2 2" />
      <Path d="M14.5 17.5l-2.6 2.6 1 1" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// SermonNotesSvg — microphone over a notes sheet
// ---------------------------------------------------------------------------

export function SermonNotesSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M4 3.5h8M4 7h5.5M4 10.5h3.5M4 14h2.5" />
      <Rect x="4" y="18" width="7" height="3.5" rx="1" />
      <Path d="M16.5 3.5a2.75 2.75 0 0 1 2.75 2.75v4a2.75 2.75 0 0 1-5.5 0v-4A2.75 2.75 0 0 1 16.5 3.5Z" />
      <Path d="M13.75 14.5a2.75 2.75 0 0 0 5.5 0M16.5 17.3v2.2M14.6 19.5h3.8" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// DailyAltarSvg — open book with radiating light above it
// ---------------------------------------------------------------------------

export function DailyAltarSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M12 6.5C9.5 4.8 6.5 4.6 3.5 5.8v12.4c3-1.2 6-1 8.5.7 2.5-1.7 5.5-1.9 8.5-.7V5.8c-3-1.2-6-1-8.5.7Z" />
      <Path d="M12 6.5v12.4" />
      <Path d="M12 2.5v1.4M8.6 3.4l.7 1.2M15.4 3.4l-.7 1.2" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// SparkleRhemaSvg — four-point sparkle with a small star
// ---------------------------------------------------------------------------

export function SparkleRhemaSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M12 4l1.7 4.8L18.5 10.5l-4.8 1.7L12 17l-1.7-4.8L5.5 10.5l4.8-1.7Z" />
      <Path d="M18.5 16.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// PrayerHandsSvg — two praying hands mirrored around a center line
// ---------------------------------------------------------------------------

export function PrayerHandsSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M11 20.5c-3.4-1.6-5.5-4-5.5-7.5V6.2A1.7 1.7 0 0 1 8.9 6v4.6c0 .5.4.9.9.9s.9-.4.9-.9V6.2A1.7 1.7 0 0 1 13.4 6" />
      <Path d="M13 20.5c3.4-1.6 5.5-4 5.5-7.5" />
      <Path d="M12 20.5v-3.2M9.2 20.5h5.6" />
      <Path d="M13.4 6v4.6c0 .5.4.9.9.9s.9-.4.9-.9V6.2A1.7 1.7 0 0 0 13.4 6" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// ProgressTrophySvg — trophy cup with handles and a base
// ---------------------------------------------------------------------------

export function ProgressTrophySvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M8 3.5h8v6a4 4 0 0 1-8 0Z" />
      <Path d="M8 5H5.5a2.5 2.5 0 0 0 2.6 4M16 5h2.5a2.5 2.5 0 0 1-2.6 4" />
      <Path d="M12 13.5v3.5M8.5 20.5a3.5 3.5 0 0 1 7 0Z" />
      <Path d="M12 20.5h.01" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// CalendarSvg — calendar frame with header pins and a dot grid
// ---------------------------------------------------------------------------

export function CalendarSvg(props: SvgIconProps) {
  const color = props.color ?? DEFAULT_COLOR;
  return (
    <Svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none">
      <Rect
        x="3.5"
        y="5"
        width="17"
        height="15.5"
        rx="3"
        stroke={color}
        strokeWidth={2}
        fill="none"
      />
      <Path
        d="M8 3v4M16 3v4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M3.5 10h17"
        stroke={color}
        strokeWidth={2}
      />
      <Circle cx="8.5" cy="14" r="1" fill={color} />
      <Circle cx="12" cy="14" r="1" fill={color} />
      <Circle cx="15.5" cy="14" r="1" fill={color} />
      <Circle cx="8.5" cy="17.2" r="1" fill={color} />
      <Circle cx="12" cy="17.2" r="1" fill={color} />
      <Circle cx="15.5" cy="17.2" r="1" fill={color} />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// ChevronLeftSvg — left navigation arrow
// ---------------------------------------------------------------------------

export function ChevronLeftSvg(props: SvgIconProps) {
  const color = props.color ?? DEFAULT_COLOR;
  return (
    <Svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M14.5 6L8.5 12L14.5 18"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// ChevronRightSvg — right navigation arrow
// ---------------------------------------------------------------------------

export function ChevronRightSvg(props: SvgIconProps) {
  const color = props.color ?? DEFAULT_COLOR;
  return (
    <Svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.5 6L15.5 12L9.5 18"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// RewindSvg — symmetrical circular rewind arrow with centered clock hands
// ---------------------------------------------------------------------------

export function RewindSvg(props: SvgIconProps) {
  const color = props.color ?? DEFAULT_COLOR;
  return (
    <Svg width={props.size ?? 24} height={props.size ?? 24} viewBox="0 0 24 24" fill="none">
      {/* Outer circular track (r = 8.5 centered at 12, 12) */}
      <Path
        d="M3.5 12a8.5 8.5 0 1 0 2.49-6.01L3.5 8.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Symmetrical rewind chevron arrowhead at top-left */}
      <Path
        d="M3.5 4v4.5H8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Centered clock hands inside (12, 12) */}
      <Path
        d="M12 8v4l2.8 1.8"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// SearchSvg — magnifying glass
// ---------------------------------------------------------------------------

export function SearchSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Circle cx="11" cy="11" r="6.25" />
      <Path d="M20 20l-4.6-4.6" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// SunMoonSvg — sun when light, crescent moon when dark (knob for toggles)
// ---------------------------------------------------------------------------

export function SunMoonSvg({
  isDark = false,
  ...props
}: SvgIconProps & { /** True renders the moon (tap switches to light). */ isDark?: boolean }) {
  return (
    <StrokeSvg {...props}>
      {isDark ? (
        <Path d="M20.5 13.2A8.2 8.2 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7Z" />
      ) : (
        <>
          <Circle cx="12" cy="12" r="4" />
          <Path d="M12 2.8v1.9M12 19.3v1.9M2.8 12h1.9M19.3 12h1.9M5.5 5.5l1.3 1.3M17.2 17.2l1.3 1.3M18.5 5.5l-1.3 1.3M6.8 17.2l-1.3 1.3" />
        </>
      )}
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// PlusVerseSvg — verse card with a plus badge
// ---------------------------------------------------------------------------

export function PlusVerseSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Rect x="4.5" y="4.5" width="15" height="15" rx="3" />
      <Path d="M12 9v6M9 12h6" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// BackupCloudSvg — cloud with an upload arrow
// ---------------------------------------------------------------------------

export function BackupCloudSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Path d="M7 18.5a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 8.6a4.5 4.5 0 0 1-.5 9.9H7Z" />
      <Path d="M12 15.5v-5M9.8 12.2 12 10l2.2 2.2" />
    </StrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// Bottom navigation tab icons
//
// Every tab renders its own crisp 24x24 icon. Each accepts the active color,
// a size, and whether the tab is currently focused — focused tabs draw with
// a slightly heavier stroke plus a dedicated accent element.
// ---------------------------------------------------------------------------

export interface TabIconProps {
  /** Tint from the tab bar (active/inactive tint). */
  color: ColorValue;
  /** Rendered square size in dp (default 24). */
  size?: number;
  /** True when the tab is selected — heavier weight + accent detail. */
  focused?: boolean;
}

function TabStrokeSvg({
  color,
  size = 24,
  focused = false,
  children,
}: TabIconProps & { children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G
        stroke={color}
        strokeWidth={focused ? 2.1 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </G>
    </Svg>
  );
}

// TabBibleSvg — open Bible with two pages and a centered spine

export function TabBibleSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <TabStrokeSvg color={color} size={size} focused={focused}>
      <Path d="M12 6.3C9.8 4.85 6.9 4.7 3.8 5.55v12.3c3.1-.85 6-.7 8.2.8 2.2-1.5 5.1-1.65 8.2-.8V5.55C17.1 4.7 14.2 4.85 12 6.3Z" />
      <Path d="M12 6.3v12.35" />
      {focused ? <Path d="M12 2.6v2.2" /> : null}
    </TabStrokeSvg>
  );
}

// TabHighlightsSvg — angled highlighter pen with a glowing underline + sparkle

export function TabHighlightsSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Highlighter pen body: rounded barrel tipped down-left at ~45°. */}
      <G
        transform="rotate(45 12.5 10.5)"
        stroke={color}
        strokeWidth={focused ? 1.9 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Rect x={9.6} y={5.4} width={5.8} height={10.2} rx={2} />
        <Path d="M9.6 15.6h5.8l-1.3 2.6h-3.2L9.6 15.6Z" fill={color} opacity={0.55} />
        <Path d="M12.5 5.4v10.2" opacity={0.5} />
        {focused ? <Rect x={11.6} y={7.2} width={1.8} height={2.4} rx={0.9} fill={color} /> : null}
      </G>
      {/* Glowing underline sweep with a soft halo pass beneath the crisp line. */}
      <Path
        d="M3.8 21h16.4"
        stroke={color}
        strokeWidth={focused ? 5.4 : 4.4}
        strokeLinecap="round"
        opacity={0.16}
      />
      <Path
        d="M3.8 21h16.4"
        stroke={color}
        strokeWidth={focused ? 2.3 : 1.7}
        strokeLinecap="round"
        opacity={0.68}
      />
      {/* Sparkle at the upper-left of the pen tip. */}
      <Path
        d="M4.1 3.2l.72 1.76 1.76.72-1.76.72-.72 1.76-.72-1.76-1.76-.72 1.76-.72.72-1.76Z"
        fill={color}
        opacity={focused ? 0.95 : 0.7}
      />
    </Svg>
  );
}

// TabMessagesSvg — sermon notebook: rounded page card with three text lines

export function TabMessagesSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <TabStrokeSvg color={color} size={size} focused={focused}>
      {/* Notebook page card. */}
      <Rect x="5" y="3" width="14" height="18" rx="2.5" />
      {/* Three text lines inside the card. */}
      <Path d="M8.5 8H15.5" />
      <Path d="M8.5 12H15.5" />
      <Path d="M8.5 16H13" />
      {focused ? <Path d="M8.5 3V21" /> : null}
    </TabStrokeSvg>
  );
}

// TabDailyWalkSvg — sun path: rising half-sun over a horizon line

export function TabDailyWalkSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <TabStrokeSvg color={color} size={size} focused={focused}>
      <Path d="M6.5 16a5.5 5.5 0 0 1 11 0" />
      <Path d="M3 16h18" />
      <Path d="M12 6.5V8M5.9 8.9l1.1 1.1M18.1 8.9L17 10" />
      <Path d="M12 19.5h.01" />
      {focused ? <Path d="M9 16c0-1.7 1.3-3 3-3s3 1.3 3 3" /> : null}
    </TabStrokeSvg>
  );
}

// TabProgressSvg — clean circular progress ring with a centered checkmark.
// Perfectly symmetrical on the 24x24 axis: the ring is a full circle centered
// at (12, 12) and the checkmark is optically centered inside it — no trend
// line, no off-axis arrowheads.

export function TabProgressSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <TabStrokeSvg color={color} size={size} focused={focused}>
      {/* Progress ring: full circle, symmetric around the center point. */}
      <Circle cx="12" cy="12" r="8.75" />
      {/* Focused accent: heavier clockwise-from-top arc (12 o'clock → 6). */}
      {focused ? <Path d="M12 3.25a8.75 8.75 0 0 1 8.75 8.75" /> : null}
      {/* Centered checkmark (spans 9→15 horizontally around cx 12). */}
      <Path d="M9 12.5l2 2 4-4" />
    </TabStrokeSvg>
  );
}

// TabVersionsSvg — Bible library shelf: three upright book spines standing on
// a horizontal shelf line, centered in the 24x24 grid.

export function TabVersionsSvg({ color, size = 24, focused = false }: TabIconProps) {
  return (
    <TabStrokeSvg color={color} size={size} focused={focused}>
      {/* Horizontal shelf line the books stand on. */}
      <Path d="M3 20.5H21" />
      {/* Upright book spine 1 (left). */}
      <Rect x="4.5" y="5" width="3.5" height="15.5" rx="1" />
      {/* Upright book spine 2 (taller middle). */}
      <Rect x="10" y="3.5" width="3.5" height="17" rx="1" />
      {/* Upright book spine 3 (right). */}
      <Rect x="15.5" y="5" width="3.5" height="15.5" rx="1" />
      {/* Focused accent: title band across the middle spine. */}
      {focused ? <Path d="M10.75 7.5H12.75" /> : null}
    </TabStrokeSvg>
  );
}

// ---------------------------------------------------------------------------
// ChecklistSvg — checked list card (Prayer Points card icon)
// ---------------------------------------------------------------------------

export function ChecklistSvg(props: SvgIconProps) {
  return (
    <StrokeSvg {...props}>
      <Rect x="4" y="4" width="16" height="16" rx="3" />
      <Path d="M7.5 8.5l1.2 1.2 2-2.2M7.5 13.5l1.2 1.2 2-2.2M7.5 17l1.2 1.2 2-2.2" />
      <Path d="M13.5 9h3M13.5 13.5h3M13.5 17.5h3" />
    </StrokeSvg>
  );
}
