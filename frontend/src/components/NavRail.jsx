import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  BarChart3,
  Film,
  FolderOpen,
  Globe,
  House,
  MessageCircle,
  Mic,
  Sun,
  Waves,
} from 'lucide-react';
import { NAV_ITEMS as ITEM_DEFS, NAV_FOOTER_ITEMS as FOOTER_DEFS } from './navItems';
import { useAppStore } from '../store';

// Shared icon-button base for the chrome rail (was `.rail-btn`). `group` enables
// the hover-reveal of the per-button tooltip label below.
const RAIL_BTN_BASE =
  'group relative inline-flex h-[36px] w-[36px] cursor-pointer items-center justify-center rounded-[var(--chrome-radius-pill)] [transition:background_0.14s,color_0.14s,border-color_0.14s]';

// Hover-reveal tooltip label (was `.rail-btn .rail-label`); flips to the opposite
// edge when the rail sits on the right.
function railLabelCls(side) {
  const sideCls =
    side === 'right'
      ? 'left-auto right-[48px] [transform:translate(4px,-50%)]'
      : 'left-[46px] [transform:translate(-4px,-50%)]';
  return `pointer-events-none absolute top-1/2 z-[10000] whitespace-nowrap rounded-[var(--chrome-radius-pill)] bg-[var(--chrome-bg)] px-[8px] py-[3px] font-sans text-[11px] font-medium text-[var(--chrome-fg)] opacity-0 [border:1px_solid_var(--chrome-border-strong)] [transition:opacity_0.15s,transform_0.15s] group-hover:opacity-100 group-hover:[transform:translate(0,-50%)] ${sideCls}`;
}

function RailBtn({ active, Icon, label, accent, side, onClick }) {
  // Active = accent-tinted fill/border + an accent indicator bar (`::before`)
  // hanging off the rail edge; flips edges with the rail side.
  const stateCls = active
    ? `text-[var(--rail-accent,var(--chrome-accent))] bg-[color-mix(in_srgb,var(--rail-accent,var(--chrome-accent))_12%,transparent)] [border:1px_solid_color-mix(in_srgb,var(--rail-accent,var(--chrome-accent))_35%,transparent)] before:absolute before:top-[20%] before:bottom-[20%] before:w-[3px] before:rounded-[2px] before:bg-[var(--rail-accent,#f3a5b6)] before:content-[''] before:[box-shadow:0_0_10px_color-mix(in_srgb,var(--rail-accent,#f3a5b6)_50%,transparent)] ${
        side === 'right' ? 'before:right-[-8px]' : 'before:left-[-8px]'
      }`
    : 'bg-transparent text-[var(--chrome-fg-dim)] [border:1px_solid_transparent] hover:bg-[var(--chrome-hover-bg)] hover:text-[var(--chrome-fg)]';
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`${RAIL_BTN_BASE} ${stateCls}`}
      style={{ '--rail-accent': accent }}
    >
      <Icon size={18} />
      <span className={railLabelCls(side)}>{label}</span>
    </button>
  );
}

export default function NavRail({ mode, setMode, side = 'left', onFlipSide }) {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const items = React.useMemo(
    () => ITEM_DEFS.map((d) => ({ ...d, label: t(`nav.${d.tKey}`) })),
    [t],
  );
  const footerItems = React.useMemo(
    () => FOOTER_DEFS.map((d) => ({ ...d, label: t(`nav.${d.tKey}`) })),
    [t],
  );
  const gemmaMode = mode === 'talk';
  const gemmaItems = React.useMemo(
    () => [
      {
        id: 'launchpad',
        Icon: House,
        tKey: 'launchpad',
        label: t('nav.launchpad'),
        accent: '#d97706',
      },
      { id: 'studio', Icon: Globe, tKey: 'voice', label: t('nav.voice'), accent: '#d97706' },
      { id: 'talk', Icon: MessageCircle, tKey: 'talk', label: t('nav.talk'), accent: '#d97706' },
      { id: 'dub', Icon: Film, tKey: 'dub', label: t('nav.dub'), accent: '#d97706' },
      { id: 'stories', Icon: Mic, tKey: 'stories', label: t('nav.stories'), accent: '#d97706' },
      {
        id: 'projects',
        Icon: FolderOpen,
        tKey: 'omnidrive',
        label: t('nav.omnidrive'),
        accent: '#d97706',
      },
      {
        id: 'catalogue',
        Icon: BarChart3,
        tKey: 'catalogue',
        label: t('nav.catalogue'),
        accent: '#d97706',
      },
    ],
    [t],
  );

  // `nav-rail` is retained purely as the layout hook the (out-of-scope)
  // `.app-container > .nav-rail` grid rules position by; all visual styling now
  // lives in the utilities below. Border flips to the inner edge when on the right.
  const asideBorder =
    side === 'right'
      ? '[border-left:1px_solid_var(--chrome-border)]'
      : '[border-right:1px_solid_var(--chrome-border)]';

  return (
    <aside
      className={`nav-rail z-50 flex select-none flex-col items-center gap-[10px] bg-[var(--chrome-bg)] pb-[10px] pt-[18px] ${asideBorder} ${gemmaMode ? 'gemma-nav-rail' : ''}`}
    >
      {gemmaMode && (
        <div className="gemma-rail-brand" aria-label="VoiceStudio">
          <Waves size={22} strokeWidth={2.2} aria-hidden="true" />
        </div>
      )}
      <div className="flex flex-1 flex-col items-center gap-[9px]">
        {(gemmaMode ? gemmaItems : items).map((it) => (
          <RailBtn
            key={it.id}
            {...it}
            side={side}
            active={mode === it.id}
            onClick={() => setMode(it.id)}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-[8px]">
        {gemmaMode && (
          <button
            type="button"
            title={t('settings.theme')}
            aria-label={t('settings.theme')}
            className={`${RAIL_BTN_BASE} text-[var(--chrome-fg-dim)] hover:bg-[var(--chrome-hover-bg)] hover:text-[var(--chrome-fg)]`}
            onClick={() => setTheme(theme === 'midnight' ? 'gruvbox' : 'midnight')}
          >
            <Sun size={18} />
          </button>
        )}
        {footerItems.map((it) => (
          <RailBtn
            key={it.id}
            {...it}
            side={side}
            active={mode === it.id}
            onClick={() => setMode(it.id)}
          />
        ))}
        <button
          onClick={onFlipSide}
          title={side === 'left' ? t('nav.move_rail_right') : t('nav.move_rail_left')}
          aria-label={t('nav.flip_rail')}
          className="relative mt-[6px] inline-flex h-[30px] w-[36px] cursor-pointer items-center justify-center rounded-none bg-transparent pt-[10px] text-[var(--chrome-fg-dim)] [border-top:1px_solid_var(--chrome-border)] [border-right:1px_solid_transparent] [border-bottom:1px_solid_transparent] [border-left:1px_solid_transparent] [transition:background_0.14s,color_0.14s,border-color_0.14s] hover:bg-transparent hover:text-[var(--chrome-accent)] hover:[transform:rotate(180deg)]"
        >
          <ArrowLeftRight size={15} />
        </button>
      </div>
    </aside>
  );
}
