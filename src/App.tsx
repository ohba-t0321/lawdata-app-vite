import './App.css'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './AuthContext'
import { DividerProvider } from './DiviserContext'
import { LawDataProvider, LawArticleProvider, ReferenceProvider } from './LawDataContext'
import { ThemeProvider } from './ThemeContext'
import Header from './Header/Header'
import Sidebar from './Sidebar/Sidebar'
import { LawDataOutput } from './LawDataOutput/LawDataOutput'
import { FullChatPage } from './AIChat/FullChatPage'

function App() {
  return (
    <div className="app">
      <ThemeProvider>
        <AuthProvider>
          <DividerProvider>
            <LawDataProvider>
              <LawArticleProvider>
                <Header />
                <Routes>
                  <Route path="/" element={(
                    <div className="content">
                      <Sidebar />
                      <ReferenceProvider>
                        <LawDataOutput />
                      </ReferenceProvider>
                    </div>
                  )} />
                  <Route path="/chat" element={(
                    <ReferenceProvider>
                      <FullChatPage />
                    </ReferenceProvider>
                  )} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </LawArticleProvider>
            </LawDataProvider>
          </DividerProvider>
        </AuthProvider>
      </ThemeProvider>
      </div>
  )
}

export default App
