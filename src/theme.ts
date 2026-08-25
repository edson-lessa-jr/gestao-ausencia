import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    primary: { main: '#075e86', dark: '#064b6b', light: '#e5f3f8' },
    secondary: { main: '#45c0cf' },
    warning: { main: '#ff8d33' },
    background: { default: '#f7fafc', paper: '#ffffff' },
    text: { primary: '#17212b', secondary: '#607080' },
    divider: '#dfe7ed',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h4: { fontSize: '1.75rem', fontWeight: 750, letterSpacing: '-0.025em' },
    h5: { fontSize: '1.25rem', fontWeight: 700 },
    h6: { fontSize: '1rem', fontWeight: 700 },
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiButton: { styleOverrides: { root: { minHeight: 40, boxShadow: 'none' } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiOutlinedInput: { styleOverrides: { root: { backgroundColor: '#fff' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 700, color: '#435466', background: '#f7fafc' } } },
  },
})
