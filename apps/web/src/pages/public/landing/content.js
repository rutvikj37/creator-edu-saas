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
  { icon: Globe, title: 'Custom domains' },
  { icon: Award, title: 'White label' },
];

export const MORE = [
  { icon: Receipt, title: 'GST invoicing', text: 'Tax-ready invoices with your GSTIN and numbering.' },
  { icon: BadgePercent, title: 'Coupons & affiliates', text: 'Discount codes, payment links and partner tracking.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales, learner activity and bandwidth, with exports.' },
  { icon: Lock, title: 'Content protection', text: 'Device limits and learner watermarks on video and PDFs.' },
  { icon: MessagesSquare, title: 'Chat & community', text: 'One inbox for learners plus discussion spaces.' },
];

export const STEPS = [
  { title: 'We set up your academy', text: 'Tell us about your brand. Our team provisions your workspace, domain and payments.' },
  { title: 'Add what you sell', text: 'Upload courses, schedule live classes, publish products and AI custom pages.' },
  { title: 'Go live and get paid', text: 'Share your link. Learners pay with UPI or cards; money settles to your bank.' },
];

export function faqs({ name }) {
  return [
    { q: `What is ${name}?`, a: `${name} is an all-in-one academy platform for teachers, coaches and institutes: host courses, run unlimited live classes and webinars, sell digital products, market to unlimited contacts, and collect payments under your own brand.` },
    { q: 'How does pricing work?', a: 'Choose Grow or Rise. Both are ₹19,999 per year. 18% GST is charged extra. Agency accounts are provisioned by our team — talk to us to get started.' },
    { q: 'What is included in every plan?', a: 'Unlimited contacts, unlimited admin accounts, unlimited live classes & webinars, 5,000 marketing emails per month, third-party integrations, unlimited products, and custom domains. Rise adds white-label branding.' },
    { q: 'How do I get paid?', a: 'You connect your own Razorpay account. Learners pay with UPI, cards, net banking or wallets and the money settles directly to your bank account on Razorpay’s schedule.' },
    { q: 'Can I use my own domain name?', a: 'Yes. Custom domains are included on Grow and Rise. We help you point DNS and go live on your brand URL.' },
    { q: 'Is my content protected?', a: 'Videos are streamed rather than offered as downloads, you can limit how many devices a learner signs in on, and videos and PDFs can carry the learner’s details as a watermark.' },
    { q: 'Can I issue GST invoices?', a: 'Yes. Add your GSTIN and business details once, and every sale generates a tax invoice in your own number series.' },
  ];
}
