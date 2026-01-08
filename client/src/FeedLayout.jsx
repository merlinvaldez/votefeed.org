import { NavLink, Outlet } from "react-router-dom";
import "./Feed.css";
import { Home, User } from "lucide-react";

export default function FeedLayout() {
  return (
    <div className="feed-layout">
      <aside className="feed-sidebar">
        <div className="brand">
          <span className="brand-mark">
            <img src="/bullhorn-solid.svg" alt="VoteFeed bullhorn" />
          </span>
          <span className="brand-name">VoteFeed</span>
        </div>

        <nav className="nav">
          <NavLink to="/feed" className="nav-item">
            <Home className="nav-icion" strokeWidth={1.75}></Home>
            <span>Feed</span>
          </NavLink>
          <NavLink to="/profile" className="nav-item">
            <User className="nav-icon" strokeWidth={1.75} />
            <span>Profile</span>
          </NavLink>
        </nav>
      </aside>
      <main className="feed-main">
        <Outlet />
      </main>
    </div>
  );
}
