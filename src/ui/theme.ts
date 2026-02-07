/* ═══════════════════════════════════════════
   Theme System — Light (macOS Azure) + Dark
   ═══════════════════════════════════════════ */

export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
    // Backgrounds
    appBg: string;
    sidebarBg: string;
    headerBg: string;
    cardBg: string;
    cardBgHover: string;
    inputBg: string;
    codeBg: string;
    artifactBg: string;
    overlayBg: string;
    // Borders
    border: string;
    borderLight: string;
    borderActive: string;
    // Text
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    textHeading: string;
    // User bubble
    userBubbleBg: string;
    userBubbleText: string;
    // Assistant bubble
    assistantBubbleBg: string;
    assistantBubbleBorder: string;
    assistantBubbleText: string;
    // Accents
    accent: string;
    accentLight: string;
    accentBorder: string;
    accentText: string;
    // Badges
    verifiedBg: string;
    verifiedBorder: string;
    verifiedText: string;
    // Sidebar item active
    sidebarItemActive: string;
    sidebarItemHover: string;
    // Tab active
    tabActive: string;
    tabInactive: string;
    // Tool chip
    toolChipBg: string;
    toolChipBorder: string;
    // Footer/trust
    trustCardBg: string;
    trustCardBorder: string;
    // Scrollbar
    scrollThumb: string;
}

export const themes: Record<ThemeMode, ThemeColors> = {
    light: {
        appBg: 'bg-gradient-to-br from-blue-50 via-white to-cyan-50/30',
        sidebarBg: 'bg-white/70 backdrop-blur-xl',
        headerBg: 'bg-white/80 backdrop-blur-sm',
        cardBg: 'bg-white/80',
        cardBgHover: 'hover:bg-white',
        inputBg: 'bg-white/90',
        codeBg: 'bg-gray-50 border-gray-200',
        artifactBg: 'bg-white/90 backdrop-blur-sm',
        overlayBg: 'bg-white/60',
        border: 'border-gray-200/80',
        borderLight: 'border-gray-100',
        borderActive: 'border-blue-400/50',
        textPrimary: 'text-gray-900',
        textSecondary: 'text-gray-600',
        textMuted: 'text-gray-400',
        textHeading: 'text-gray-900',
        userBubbleBg: 'bg-gradient-to-r from-blue-500 to-blue-600',
        userBubbleText: 'text-white',
        assistantBubbleBg: 'bg-white shadow-sm',
        assistantBubbleBorder: 'border border-gray-200/60',
        assistantBubbleText: 'text-gray-800',
        accent: 'bg-gradient-to-r from-blue-500 to-cyan-500',
        accentLight: 'bg-blue-50',
        accentBorder: 'border-blue-200',
        accentText: 'text-blue-600',
        verifiedBg: 'bg-emerald-50',
        verifiedBorder: 'border-emerald-200',
        verifiedText: 'text-emerald-600',
        sidebarItemActive: 'bg-blue-50/80 border border-blue-200/50',
        sidebarItemHover: 'hover:bg-gray-50',
        tabActive: 'bg-blue-50 text-blue-700',
        tabInactive: 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
        toolChipBg: 'bg-gray-50 hover:bg-gray-100',
        toolChipBorder: 'border-gray-200',
        trustCardBg: 'bg-gradient-to-r from-emerald-50 to-blue-50',
        trustCardBorder: 'border-emerald-200/50',
        scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-gray-300/50',
    },
    dark: {
        appBg: 'bg-[#0c0c14]',
        sidebarBg: 'bg-[#0e0e18]',
        headerBg: 'bg-transparent',
        cardBg: 'bg-gray-800/40',
        cardBgHover: 'hover:bg-gray-800/60',
        inputBg: 'bg-gray-800/50',
        codeBg: 'bg-gray-900/80 border-gray-800',
        artifactBg: 'bg-[#0e0e18]',
        overlayBg: 'bg-gray-900/60',
        border: 'border-gray-800/60',
        borderLight: 'border-gray-700/30',
        borderActive: 'border-violet-500/40',
        textPrimary: 'text-gray-200',
        textSecondary: 'text-gray-400',
        textMuted: 'text-gray-600',
        textHeading: 'text-white',
        userBubbleBg: 'bg-blue-600',
        userBubbleText: 'text-white',
        assistantBubbleBg: 'bg-gray-800/50',
        assistantBubbleBorder: 'border border-gray-700/30',
        assistantBubbleText: 'text-gray-200',
        accent: 'bg-gradient-to-r from-violet-600/20 to-blue-600/20',
        accentLight: 'bg-violet-500/10',
        accentBorder: 'border-violet-500/20',
        accentText: 'text-violet-300',
        verifiedBg: 'bg-emerald-500/8',
        verifiedBorder: 'border-emerald-500/20',
        verifiedText: 'text-emerald-400',
        sidebarItemActive: 'bg-gray-800/80 border border-gray-700/30',
        sidebarItemHover: 'hover:bg-gray-800/40',
        tabActive: 'bg-gray-800/80 text-white',
        tabInactive: 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/40',
        toolChipBg: 'bg-gray-800/60 hover:bg-gray-700/60',
        toolChipBorder: 'border-gray-700/40',
        trustCardBg: 'bg-gradient-to-r from-emerald-500/5 to-violet-500/5',
        trustCardBorder: 'border-emerald-500/15',
        scrollThumb: '[&::-webkit-scrollbar-thumb]:bg-gray-700/40',
    },
};
