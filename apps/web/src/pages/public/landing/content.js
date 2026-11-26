import { Award, BadgePercent, BarChart3, BookOpen, CreditCard, Globe, Lock, MessagesSquare, Radio, Receipt, Megaphone, Download, Users, Plug } from 'lucide-react';

/** Sales pillars — what agencies buy TechX LMS for. */
export const PILLARS = [
  { icon: BookOpen, title: 'Courses & unlimited products', text: 'Video, PDFs, quizzes and assignments. Sell courses, e-books and bundles without a product ceiling.', tone: 'bg-[#0f5c56]', wide: true },
  { icon: Globe, title: 'Your brand, your domain', text: 'Academy site on your custom domain, in your colours — including AI custom pages for high-converting landings.', tone: 'bg-[#1e3a5f]', wide: true },
  { icon: Radio, title: 'Unlimited live classes & webinars', text: 'Schedule, teach, take attendance and share recordings with no per-session caps.', tone: 'bg-[#0f172a]' },
  { icon: Megaphone, title: '5,000 marketing emails / month', text: 'Campaigns and reminders that bring learners back — without a separate ESP.', tone: 'bg-[#14532d]' },
  { icon: CreditCard, title: 'Payments built in', text: 'UPI, cards and wallets through your own Razorpay account. Money settles to your bank.', tone: 'bg-[#0c4a6e]' },
];

/** Launch modules shown as a conversion strip (matches Grow/Rise entitlements). */
export const LAUNCH_STRIP = [
  { icon: Users, title: 'Unlimited Contacts' },
  { icon: Users, title: 'Unlimited Admin Accounts' },
  { icon: Radio, title: 'Unlimited Live Classes & Webinars' },
  { icon: Megaphone, title: '5,000 Marketing Emails/Month' },
  { icon: Plug, title: 'Third Party Integrations' },
  { icon: Download, title: 'Unlimited Products' },
  { icon: Globe, title: '1 custom domain' },
  { icon: Award, title: 'White label' },
];

export const MORE = [
  { icon: Receipt, title: 'GST invoicing', text: 'Tax-ready invoices with your GSTIN and numbering.' },
  { icon: BadgePercent, title: 'Coupons & affiliates', text: 'Discount codes, payment links and partner tracking.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales, learner activity and bandwidth, with exports.' },
  { icon: Lock, title: 'Content protection', text: 'Device limits and learner watermarks on video and PDFs.' },
  { icon: MessagesSquare, title: 'Chat & community', text: 'One inbox for learners plus discussion spaces.' },
];

/** Done-for-you onboarding — sold as a guided agency launch, not self-serve DIY. */
export const STEPS = [
  { title: 'Onboard configured for you', text: 'Share your brand, courses and goals. We provision your academy workspace so you start ready, not blank.' },
  { title: 'Create your landing page', text: 'We help you customize a high-converting academy site in your colours — or bring your own design direction.' },
  { title: 'Configure your agency', text: 'Domains, payments, staff roles, GST and products get wired correctly before learners ever see a checkout.' },
  { title: 'Training & support', text: 'Your team gets a walkthrough of courses, live classes, marketing and billing — plus ongoing help when you need it.' },
  { title: 'Go live and sell', text: 'Point DNS, publish, and take your first payment. Money settles to your bank through your own Razorpay account.' },
];

export function faqs({ name }) {
  return [
    { q: `What is ${name}?`, a: `${name} is an all-in-one academy platform for teachers, coaches and institutes: host courses, run unlimited live classes and webinars, sell digital products, market to unlimited contacts, and collect payments under your own brand.` },
    { q: 'How does pricing work?', a: 'Grow is ₹16,999 for 6 months. Rise is ₹19,999 for 12 months. Both include the same modules (including white label). 18% GST is charged extra. Agency accounts are provisioned by our team — talk to us to get started.' },
    { q: 'What is included in every plan?', a: 'Unlimited contacts, unlimited admin accounts, unlimited live classes & webinars, 5,000 marketing emails per month, third-party integrations, unlimited products, custom domains, and white-label branding. Grow and Rise differ only by billing period and price.' },
    { q: 'How do I get paid?', a: 'You connect your own Razorpay account. Learners pay with UPI, cards, net banking or wallets and the money settles directly to your bank account on Razorpay’s schedule.' },
    { q: 'Can I use my own domain name?', a: 'Yes. One custom domain is included on Grow and Rise. We help you point DNS and go live on your brand URL.' },
    { q: 'Is my content protected?', a: 'Videos are streamed rather than offered as downloads, you can limit how many devices a learner signs in on, and videos and PDFs can carry the learner’s details as a watermark.' },
    { q: 'Can I issue GST invoices?', a: 'Yes. Add your GSTIN and business details once, and every sale generates a tax invoice in your own number series.' },
  ];
}
