import { Award, BadgePercent, BarChart3, BookOpen, CreditCard, Globe, Lock, MessagesSquare, Radio, Receipt, Megaphone, Download, Layers, Sparkles } from 'lucide-react';

/** Sales pillars — what agencies buy TechX LMS for. */
export const PILLARS = [
  { icon: BookOpen, title: 'Courses & digital products', text: 'Structure lessons with video, PDFs, quizzes and assignments. Sell unlimited products, drip content, and issue certificates automatically.', tone: 'bg-teal-600', wide: true },
  { icon: Globe, title: 'Your brand, your domain', text: 'Academy website on your custom domain, in your colours, with AI custom pages and a page builder for high-converting landings.', tone: 'bg-amber-600', wide: true },
  { icon: Radio, title: 'Unlimited live classes & webinars', text: 'Schedule classes, take attendance, chat with learners and share recordings — without per-session caps.', tone: 'bg-slate-800' },
  { icon: Megaphone, title: 'Marketing that stays with you', text: '5,000 marketing emails every month, campaigns and reminders so learners come back without a separate ESP.', tone: 'bg-teal-700' },
  { icon: CreditCard, title: 'Payments built in', text: 'Collect with UPI, cards, net banking and wallets through your own Razorpay account. Money settles to your bank.', tone: 'bg-sky-700' },
];

export const MORE = [
  { icon: Layers, title: 'Unlimited contacts', text: 'Grow your list without contact ceilings on Grow or Rise.' },
  { icon: Sparkles, title: 'AI custom pages', text: 'Generate and refine sales pages that match your brand.' },
  { icon: Download, title: 'Unlimited products', text: 'Courses, e-books, templates and bundles in one catalogue.' },
  { icon: Receipt, title: 'GST invoicing', text: 'Tax-ready invoices with your GSTIN and numbering.' },
  { icon: BadgePercent, title: 'Coupons & affiliates', text: 'Discount codes, payment links and partner tracking.' },
  { icon: BarChart3, title: 'Reports', text: 'Sales, learner activity and bandwidth, with exports.' },
  { icon: Lock, title: 'Content protection', text: 'Device limits and learner watermarks on video and PDFs.' },
  { icon: MessagesSquare, title: 'Chat & community', text: 'One inbox for learners plus discussion spaces.' },
  { icon: Award, title: 'Certificates', text: 'Branded certificates anyone can verify with a link.' },
  { icon: Globe, title: 'White label', text: 'Remove platform branding on Rise — full brand control.' },
];

export const STEPS = [
  { title: 'We set up your academy', text: 'Tell us about your brand. Our team provisions your workspace, domain and payments.' },
  { title: 'Add what you sell', text: 'Upload courses, schedule live classes, publish digital products and AI custom pages.' },
  { title: 'Launch and get paid', text: 'Share your link. Learners pay with UPI or cards; money settles to your bank.' },
];

export const TRUST = [
  { label: 'Custom domains', detail: 'Teach on your own URL' },
  { label: 'Razorpay ready', detail: 'UPI, cards, wallets' },
  { label: 'GST invoices', detail: 'Your GSTIN, your series' },
  { label: 'White label', detail: 'Available on Rise' },
];

export function faqs({ name }) {
  return [
    { q: `What is ${name}?`, a: `${name} is an all-in-one academy platform for teachers, coaches and institutes: host courses, run unlimited live classes and webinars, sell digital products, market to unlimited contacts, and collect payments under your own brand.` },
    { q: 'How does pricing work?', a: 'Choose Grow or Rise. Both are ₹19,999 per year. 18% GST is charged extra. Agency accounts are provisioned by our team — talk to us to get started.' },
    { q: 'What is included in every plan?', a: 'Unlimited contacts, unlimited admin accounts, unlimited live classes & webinars, 5,000 marketing emails per month, third-party integrations, unlimited products, custom domains, and AI custom pages. Rise adds white-label branding.' },
    { q: 'How do I get paid?', a: 'You connect your own Razorpay account. Learners pay with UPI, cards, net banking or wallets and the money settles directly to your bank account on Razorpay’s schedule.' },
    { q: 'Can I use my own domain name?', a: 'Yes. Custom domains are included on Grow and Rise. We help you point DNS and go live on your brand URL.' },
    { q: 'Is my content protected?', a: 'Videos are streamed rather than offered as downloads, you can limit how many devices a learner signs in on, and videos and PDFs can carry the learner’s details as a watermark.' },
    { q: 'Can I issue GST invoices?', a: 'Yes. Add your GSTIN and business details once, and every sale generates a tax invoice in your own number series.' },
  ];
}
