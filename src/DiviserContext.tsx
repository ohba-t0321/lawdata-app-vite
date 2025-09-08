import { createContext, useState } from 'react';
import type { ReactNode } from 'react';

export type DividerContextType = {
  dividerPos: number;
  setDividerPos: (dividerPos: number) => void;
};

export const DividerContext = createContext<DividerContextType>({
  dividerPos:99,
  setDividerPos:()=>{}
  });

export const DividerProvider = ({ children } : { children: ReactNode } ) => {
  const [dividerPos, setDividerPos] = useState(99); // 初期位置を99%に設定
  return (
    <DividerContext.Provider value={{ dividerPos, setDividerPos }}>
      {children}
    </DividerContext.Provider>

  )
}

