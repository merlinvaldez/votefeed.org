import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import RequireFeedData from "./RequireFeedData";
import LandingPage from "./LandingPage";
import Feed from "./Feed";
import BillPage from "./BillPage";
import Login from "./Login";
import Signup from "./Signup";
import Profile from "./Profile";
import FeedLayout from "./FeedLayout";
import Onboarding from "./Onboarding";
import RequireOnboarding from "./RequireOnboarding";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login/*" element={<Login></Login>} />
        <Route path="/signup/*" element={<Signup></Signup>} />
        <Route path="/onboarding" element={<Onboarding></Onboarding>} />
        <Route element={<RequireOnboarding />}>
          <Route element={<FeedLayout />}>
            <Route path="/feed" element={<Feed></Feed>} />
            <Route path="/bill/:billType/:billNumber" element={<BillPage />} />
            <Route path="/profile" element={<Profile />} />
          </Route>
        </Route>
      </Routes>
      <Analytics />
    </BrowserRouter>
  );
}

export default App;
