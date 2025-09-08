import './App.css'
import { DividerProvider } from './DiviserContext'
import { LawDataProvider, LawArticleProvider, ReferenceProvider } from './LawDataContext'
import { ThemeProvider } from './ThemeContext'
import Header from './Header/Header'
import Sidebar from './Sidebar/Sidebar'
import { LawDataOutput } from './LawDataOutput/LawDataOutput'

function App() {
  return (
      <div className="app">
        <ThemeProvider>
          <DividerProvider>
            <LawDataProvider>
              <LawArticleProvider>
                {/* ヘッダー */}
                <Header />
                <div className="content">
                  <Sidebar />
                  <ReferenceProvider> 
                    <LawDataOutput />
                  </ReferenceProvider> 
                </div>
              </LawArticleProvider>
            </LawDataProvider>
          </DividerProvider>
        </ThemeProvider>
      </div>
  )
}

export default App
