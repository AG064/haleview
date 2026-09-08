import { CalendarDays, ChartLine, ShoppingCart } from "lucide-react";

export function LandingPreview() {
  return <aside className="landing-preview" aria-label="Everyday wellbeing with Haleview">
    <figure className="landing-preview-photo">
      <img src="/images/lifestyle/preparing-salad.jpg" alt="A person preparing a fresh salad in a sunlit kitchen" width="1200" height="1800" />
    </figure>
    <div className="landing-preview-details landing-lifestyle-card">
      <h2>Your day, in one place.</h2>
      <p>Make a plan that fits your life.</p>
      <ul className="landing-lifestyle-features">
        <li><CalendarDays aria-hidden="true" /><span>Plan meals</span></li>
        <li><ShoppingCart aria-hidden="true" /><span>Shop simply</span></li>
        <li><ChartLine aria-hidden="true" /><span>Track progress</span></li>
      </ul>
    </div>
    <p className="landing-preview-credit">Photo by <a href="https://www.pexels.com/photo/a-person-making-salad-9004734/" target="_blank" rel="noreferrer">olia danilevich</a> on Pexels.</p>
  </aside>;
}
