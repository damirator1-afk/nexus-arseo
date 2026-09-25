/**
 * Plain inline SVG icons matching the reference product's exact stroke spec
 * (viewBox 0 0 24 24, currentColor stroke, width 2.5, round caps/joins, no fill).
 * Reused at different sizes: 34px inside KPI tile chips, 12px inside status pills.
 */
type IconProps = { size?: number };

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function AlertIcon(props: IconProps) {
  return <Svg {...props}><path d="M12 3l10 18H2z" /><path d="M12 10v4M12 17.5v.5" /></Svg>;
}

export function ClockIcon(props: IconProps) {
  return <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
}

export function BoxIcon(props: IconProps) {
  return <Svg {...props}><path d="M3 7l9-4 9 4v10l-9 4-9-4z" /><path d="M3 7l9 4 9-4M12 11v10" /></Svg>;
}

export function CoinIcon(props: IconProps) {
  return <Svg {...props}><circle cx="12" cy="12" r="9" /><path d="M9 9.5h4.5a2 2 0 010 4H10a2 2 0 000 4H15M12 7v2M12 17.5V19" /></Svg>;
}

export function SearchIcon(props: IconProps) {
  return <Svg {...props}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></Svg>;
}
