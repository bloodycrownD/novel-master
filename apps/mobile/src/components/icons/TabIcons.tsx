/**
 * Bottom tab icons (SVG paths from examples/mobile/index.html).
 */
import React from 'react';
import Svg, {Circle, Line, Path} from 'react-native-svg';

type IconProps = {
  color: string;
  size?: number;
};

export function ChatTabIcon({color, size = 24}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function AgentTabIcon({color, size = 24}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ProfileTabIcon({color, size = 24}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle
        cx={12}
        cy={7}
        r={4}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Theme toggle: sun (light mode). */
export function SunIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={5} stroke={color} strokeWidth={2} />
      <Line x1={12} y1={1} x2={12} y2={3} stroke={color} strokeWidth={2} />
      <Line x1={12} y1={21} x2={12} y2={23} stroke={color} strokeWidth={2} />
      <Line x1={4.22} y1={4.22} x2={5.64} y2={5.64} stroke={color} strokeWidth={2} />
      <Line x1={18.36} y1={18.36} x2={19.78} y2={19.78} stroke={color} strokeWidth={2} />
      <Line x1={1} y1={12} x2={3} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={21} y1={12} x2={23} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={4.22} y1={19.78} x2={5.64} y2={18.36} stroke={color} strokeWidth={2} />
      <Line x1={18.36} y1={5.64} x2={19.78} y2={4.22} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Theme toggle: moon (dark mode). */
export function MoonIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Header menu icon. */
export function MenuIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={3} y1={6} x2={21} y2={6} stroke={color} strokeWidth={2} />
      <Line x1={3} y1={12} x2={21} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={3} y1={18} x2={21} y2={18} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Header back icon. */
export function BackIcon({color, size = 22}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 12H5M12 19l-7-7 7-7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
