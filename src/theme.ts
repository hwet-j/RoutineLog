import { useColorScheme } from 'react-native';

const base = { primary: '#6D28D9', ok: '#16A34A', warn: '#F59E0B', miss: '#EF4444', med: '#2563EB', sup: '#16A34A', habit: '#7C3AED' };
export const light = {
  ...base, dark: false, bg: '#F6F4FB', card: '#FFFFFF', text: '#1E1B2E', sub: '#6B6880', faint: '#A19FB3',
  line: '#E7E4F1', primarySoft: '#EDE9FE', input: '#F1EFF8', danger: '#DC2626', shadow: '0 1px 6px rgba(30,27,46,0.08)',
  heat0: '#ECE9F5', heat1: '#C4B5FD', heat2: '#8B5CF6', heat3: '#6D28D9',
};
export const dark = {
  ...base, dark: true, bg: '#0F0D18', card: '#1A1726', text: '#F1EFF8', sub: '#A19FB3', faint: '#6B6880',
  line: '#2A2638', primarySoft: '#2E2352', input: '#221F31', danger: '#F87171', shadow: 'none', primary: '#A78BFA', med: '#60A5FA', sup: '#4ADE80', habit: '#A78BFA',
  heat0: '#221F31', heat1: '#4C3A8A', heat2: '#7C5CE0', heat3: '#A78BFA',
};
export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);
export const R = { sm: 10, md: 14, lg: 20, pill: 999 };
