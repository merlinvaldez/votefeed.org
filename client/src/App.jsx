import { BrowserRouter, Routes, Route } from "react-router-dom";
import RequireFeedData from "./RequireFeedData";
import LandingPage from "./LandingPage";
import Feed from "./Feed";
import BillPage from "./BillPage";
import Login from "./Login";
import Signup from "./Signup";
import Profile from "./Profile";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login></Login>} />
        <Route path="/Signup" element={<Signup></Signup>} />
        <Route
          path="/feed"
          element={
            <RequireFeedData>
              <Feed></Feed>
            </RequireFeedData>
          }
        />
        <Route path="/bill/:billNumber" element={<BillPage />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
