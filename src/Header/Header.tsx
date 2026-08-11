import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import './Header.css';
import { AuthContext } from '../AuthContext';

const Header = () => {
  const { isConfigured, loading, session, profile, authError, signInWithOtp, signOut } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = headerRef.current;
    if (!element) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty('--app-header-height', `${element.offsetHeight}px`);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  const userLabel = useMemo(() => {
    if (profile?.email) return `${profile.email} (${profile.role})`;
    if (session?.user?.email) return session.user.email;
    return '';
  }, [profile, session?.user?.email]);

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = await signInWithOtp(email);
    if (error) {
      setNotice(error);
      return;
    }
    setNotice('ログインリンクを送信しました。招待済みメールアドレスを確認してください。');
    setEmail('');
  };

  return (
    <header className="app-header" ref={headerRef}>
      <div className="header-main">
        <div className="header-title-wrap">
          <NavLink to="/" className="header-brand" aria-label="法令検索ホーム">
            <h1>法令検索アプリ</h1>
          </NavLink>
          <nav className="header-nav" aria-label="メインナビゲーション">
            <NavLink to="/" end className={({ isActive }) => `header-nav-link${isActive ? ' active' : ''}`}>
              法令を読む
            </NavLink>
            <NavLink to="/chat" className={({ isActive }) => `header-nav-link chat-link${isActive ? ' active' : ''}`}>
              法令AIに質問
            </NavLink>
          </nav>
        </div>
        <div className="header-auth">
          {!isConfigured ? (
            <div className="auth-status disabled">AIチャット未設定</div>
          ) : loading ? (
            <div className="auth-status">認証状態を確認中...</div>
          ) : session ? (
            <div className="auth-session">
              <span className="auth-user">{userLabel}</span>
              <button type="button" className="auth-button" onClick={() => { void signOut(); }}>
                サインアウト
              </button>
            </div>
          ) : (
            <div className="auth-login">
              <button
                type="button"
                className="auth-button"
                onClick={() => {
                  setIsAuthOpen((prev) => !prev);
                  setNotice(null);
                }}
              >
                ログイン
              </button>
              {isAuthOpen ? (
                <form className="auth-form" onSubmit={handleSignIn}>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="招待済みメールアドレス"
                    className="auth-input"
                  />
                  <button type="submit" className="auth-button">
                    リンク送信
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      </div>
      {notice || authError ? (
        <div className="header-notice">{notice ?? authError}</div>
      ) : null}
    </header>
  );
};

export default Header;
