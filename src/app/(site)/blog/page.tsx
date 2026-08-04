import type { Metadata } from "next";
import { PageHero } from "@/components/ui/PageHero";
import { NewsletterForm } from "@/components/forms/NewsletterForm";

export const metadata: Metadata = {
  title: "Freight Insights — Market Updates & Dispatch Strategy | PickLoads",
  description:
    "Market updates, dispatch strategy and FMCSA news — written for the people actually running trucks.",
};

/*
 * M-33 replaces this array with a Supabase query on `posts`
 * (locale + published). These four entries are the V4 sample cards — kept for
 * layout verification, EXCLUDED from launch by the go-live checklist unless
 * real articles replace them first (audit F-13; arch: 2 articles at launch).
 */
const SAMPLE_POSTS = [
  ["c1", "Freight Market", "Freight Market Update: What Q3 Rates Are Telling Us", "Spot rates, contract spreads and what it means for owner-operators planning the next 90 days.", "SAMPLE ARTICLE · 6 MIN READ"],
  ["c2", "Dispatch Tips", "5 Signs Your Dispatcher Is Costing You Money", "From unchecked brokers to deadhead-heavy planning — how to audit the service behind your truck.", "SAMPLE ARTICLE · 5 MIN READ"],
  ["c3", "FMCSA News", "FMCSA Updates Every Carrier Should Know This Quarter", "Registration changes, broker transparency rules and what's coming for new authorities.", "SAMPLE ARTICLE · 7 MIN READ"],
  ["c4", "Fuel Prices", "Diesel Watch: Managing Fuel Costs When Prices Swing", "Fuel surcharges, card programs and route planning tactics that protect your margin.", "SAMPLE ARTICLE · 5 MIN READ"],
] as const;

export default function BlogPage() {
  return (
    <main>
      <PageHero eyebrow="Freight Insights" title="The road, the rates, the rules.">
        Market updates, dispatch strategy and FMCSA news — written for the
        people actually running trucks.
      </PageHero>

      <section>
        <div className="wrap">
          <div className="blog-grid">
            {SAMPLE_POSTS.map(([cover, tag, title, excerpt, meta]) => (
              <a className="post" key={title}>
                <div className={`cover ${cover}`}>{tag}</div>
                <div className="body">
                  <h3>{title}</h3>
                  <p>{excerpt}</p>
                  <span className="meta">{meta}</span>
                </div>
              </a>
            ))}
          </div>
          <NewsletterForm />
        </div>
      </section>
    </main>
  );
}
