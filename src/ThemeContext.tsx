// ThemeContext.tsx
import React, { createContext, useState } from "react";
import type { ReactNode } from "react";

export type Theme = 'normal'|'colorful'|'none';

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void; 
};

export const ThemeContext = createContext<ThemeContextType>({
  theme: 'normal',
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>("normal");

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      <div className={`theme-${theme}`}>{children}</div>
    </ThemeContext.Provider>
  );
};