import { BrowserRouter, Routes, Route } from "react-router-dom";
import RequireFeedData from "./RequireFeedData";
import LandingPage from "./LandingPage";
import Feed from "./Feed";
import BillPage from "./BillPage";
import Login from "./Login";
import Signup from "./Signup";
import Profile from "./Profile";
import FeedLayout from "./FeedLayout";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login></Login>} />
        <Route path="/Signup" element={<Signup></Signup>} />
        <Route element={<FeedLayout />}>
          <Route path="/feed" element={<Feed></Feed>} />
          <Route path="/bill/:billNumber" element={<BillPage />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
