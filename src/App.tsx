import './App.css'
import { AuthProvider } from './AuthContext'
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
        <AuthProvider>
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
        </AuthProvider>
      </ThemeProvider>
      </div>
  )
}

export default App
