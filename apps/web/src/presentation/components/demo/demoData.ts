// Sample content for the landing-page demo. Everything here is FICTIONAL —
// the candidate, the employer and the past employers are made up, so the
// demo never shows a real person or puts words in a real company's mouth.
// The artifacts are written to the same shape and standard as the real
// generators' output (tailored bullets with numbers, a letter specific to the
// role, a ≤280-char LinkedIn note, interview questions with why-asked /
// how-to-answer in English and Bangla). Content stays English, like the real
// output; the demo's chrome is localized through `demo.*` strings.

export const DEMO_JOB = {
  title: 'Executive, Digital Marketing',
  company: 'Padma Foods Ltd.',
  location: 'Dhaka (Tejgaon)',
  deadline: 'Apply by 15 November',
  intro:
    'Padma Foods is looking for a hands-on digital marketer to grow our snack brands on Facebook and Google.',
  requirements: [
    'BBA/MBA in Marketing or a related subject',
    '1–2 years running Facebook and Google ad campaigns',
    'Hands-on with Meta Ads Manager and Google Analytics',
    'Clear writing in English and Bangla for posts and ads',
    'Report campaign results with data in Excel',
    'Work closely with the sales and design teams',
  ],
};

/** The text that "lands" in the job box when pasted. */
export const DEMO_JD_PASTE = `${DEMO_JOB.title} — ${DEMO_JOB.company}
${DEMO_JOB.intro}
Requirements:
${DEMO_JOB.requirements.map((r) => `• ${r}`).join('\n')}`;

export const DEMO_PROFILE = {
  name: 'Tasnia Rahman',
  headline: 'Digital Marketing Associate',
  items: [
    { id: 'edu', label: 'BBA in Marketing, University of Dhaka (2023)' },
    { id: 'kotha', label: 'Digital Marketing Associate, Kotha Lifestyle (2024 – now)' },
    { id: 'shapla', label: 'Marketing Intern, Shapla Telecom (2024)' },
    { id: 'skills', label: 'Meta Ads Manager · Google Analytics · Excel · Canva' },
    { id: 'cert', label: 'Google Ads Search certification (2025)' },
    { id: 'lang', label: 'Writes posts in English and Bangla' },
  ],
};

export type MatchStatus = 'matched' | 'partial';

/** One row per requirement, in order, with the profile item it came from. */
export const DEMO_MATCHES: { status: MatchStatus; source: string; profileId: string }[] = [
  { status: 'matched', source: 'BBA in Marketing', profileId: 'edu' },
  { status: 'partial', source: 'Kotha Lifestyle (Facebook ads) + Google Ads certification', profileId: 'cert' },
  { status: 'matched', source: 'Skills', profileId: 'skills' },
  { status: 'matched', source: 'Languages', profileId: 'lang' },
  { status: 'matched', source: 'Kotha Lifestyle', profileId: 'kotha' },
  { status: 'matched', source: 'Shapla Telecom', profileId: 'shapla' },
];

export const DEMO_RESUME = {
  name: 'Tasnia Rahman',
  contact: 'Dhaka · tasnia.rahman@email.com · +880 1XXX-XXXXXX · linkedin.com/in/tasniarahman',
  summary:
    'Digital marketer with 1.5 years of hands-on Meta Ads experience for a Dhaka e-commerce brand. Plans, runs and reports Facebook campaigns end to end, writes ad copy in English and Bangla, and turns Google Analytics data into clear Excel reports for sales.',
  experience: [
    {
      role: 'Digital Marketing Associate',
      org: 'Kotha Lifestyle, Dhaka',
      dates: 'Jul 2024 – Present',
      bullets: [
        'Run 12+ Facebook and Instagram campaigns a month in Meta Ads Manager with a ৳3 lakh monthly budget; cut cost per purchase by 28% in six months.',
        'Built a weekly Excel report from Google Analytics and Meta data that the sales team now uses to plan stock for Eid campaigns.',
        'Write and test ad copy in English and Bangla; Bangla variants lifted click-through rate by 1.6× on the same creative.',
        'Brief the two-person design team on creatives for every campaign and keep a shared calendar of launches.',
      ],
    },
    {
      role: 'Marketing Intern',
      org: 'Shapla Telecom, Dhaka',
      dates: 'Jan 2024 – Jun 2024',
      bullets: [
        'Supported the regional sales team with campaign material for 40+ retail points across Dhaka division.',
        'Tracked post performance across 3 Facebook pages and presented monthly results to the brand manager.',
      ],
    },
  ],
  education: 'BBA in Marketing — University of Dhaka, 2023 (CGPA 3.52)',
  certification: 'Google Ads Search certification — Google, 2025',
  skills: ['Meta Ads Manager', 'Google Analytics', 'Excel (pivot tables)', 'Ad copy — English & Bangla', 'Canva', 'Campaign reporting'],
};

export const DEMO_COVER_LETTER = `Dear Hiring Manager,

Padma Foods' snack brands already have a loyal following on Facebook, and the Executive, Digital Marketing role is about growing that following into sales. That is the work I do every day at Kotha Lifestyle.

For the last 15 months I have planned and run our Facebook and Instagram campaigns in Meta Ads Manager — 12 or more a month on a ৳3 lakh budget — and brought our cost per purchase down by 28%. I write the ad copy in both English and Bangla, and I report results the way a sales team can use them: a weekly Excel sheet built from Google Analytics and Meta data that our sales lead now plans stock from.

You also ask for Google Ads experience. My paid work so far has been on Meta, but the skills carry over directly — audience building, testing creatives, reading conversion data — and I completed Google's Ads Search certification this year to be ready from the first month.

I would welcome the chance to show you how I would plan Padma Foods' next campaign.

Sincerely,
Tasnia Rahman`;

export const DEMO_EMAIL = {
  subject: 'Digital Marketing Executive application — Meta Ads, 28% lower cost per purchase',
  body: `Dear Hiring Manager,

I have just applied for the Executive, Digital Marketing role at Padma Foods and wanted to reach you directly.

At Kotha Lifestyle I run 12+ Facebook campaigns a month in Meta Ads Manager and cut our cost per purchase by 28% in six months. I write ads in English and Bangla and send sales a weekly Excel report built from Google Analytics.

I would be glad to share a few campaign results if it helps. Thank you for your time.

Best regards,
Tasnia Rahman
+880 1XXX-XXXXXX`,
};

export const DEMO_LINKEDIN =
  "Hello — I've applied for the Digital Marketing Executive role at Padma Foods. I run Meta ad campaigns for a Dhaka e-commerce brand (28% lower cost per purchase) and would love to connect and learn more about the team.";

export const DEMO_INTERVIEW: {
  q: string; qBn: string; category: string;
  why: string; whyBn: string; how: string; howBn: string;
}[] = [
  {
    category: 'Role-specific',
    q: 'Walk me through a Facebook campaign you planned from start to finish. What would you change if you ran it again?',
    qBn: 'শুরু থেকে শেষ পর্যন্ত আপনার পরিকল্পনা করা একটা ফেসবুক ক্যাম্পেইনের কথা বলুন। আবার চালালে কী বদলাতেন?',
    why: 'They want proof you can own a campaign alone — budget, audience, creative and reporting — not just post content.',
    whyBn: 'তারা দেখতে চান আপনি একা পুরো ক্যাম্পেইন সামলাতে পারেন কি না — বাজেট, অডিয়েন্স, ক্রিয়েটিভ আর রিপোর্টিং — শুধু পোস্ট দেওয়া না।',
    how: 'Pick the Kotha Lifestyle campaign that cut cost per purchase. Goal → audience → budget → what you tested → the 28% result. End with one honest change, e.g. testing more Bangla creatives earlier.',
    howBn: 'Kotha Lifestyle-এর যে ক্যাম্পেইনে খরচ কমেছিল সেটা বলুন। লক্ষ্য → অডিয়েন্স → বাজেট → কী টেস্ট করেছিলেন → ২৮% ফল। শেষে একটা সৎ পরিবর্তনের কথা বলুন, যেমন আরও আগে বাংলা ক্রিয়েটিভ টেস্ট করা।',
  },
  {
    category: 'Technical',
    q: 'You have not run Google Ads campaigns yet. How would you get up to speed here?',
    qBn: 'আপনি এখনো Google Ads ক্যাম্পেইন চালাননি। এখানে কীভাবে দ্রুত শিখে নেবেন?',
    why: 'This is the one gap in your profile against the job post. They are checking whether you see it and have a plan.',
    whyBn: 'জব পোস্টের তুলনায় আপনার প্রোফাইলে এটাই একমাত্র ঘাটতি। তারা দেখছেন আপনি সেটা বোঝেন কি না আর পরিকল্পনা আছে কি না।',
    how: 'Own it in one sentence, then show the bridge: the Search Ads certification, what transfers from Meta (audiences, testing, conversion data), and a 30-day plan.',
    howBn: 'এক বাক্যে স্বীকার করুন, তারপর সেতুটা দেখান: Search Ads সার্টিফিকেশন, Meta থেকে কী কাজে লাগবে (অডিয়েন্স, টেস্টিং, কনভার্সন ডেটা), আর ৩০ দিনের একটা পরিকল্পনা।',
  },
  {
    category: 'Behavioral',
    q: 'Tell me about a time sales and marketing disagreed. How did you handle it?',
    qBn: 'এমন একটা সময়ের কথা বলুন যখন সেলস আর মার্কেটিং একমত ছিল না। আপনি কীভাবে সামলেছিলেন?',
    why: 'The job post asks you to work closely with sales and design. They want to see you use data to settle disagreements, not opinions.',
    whyBn: 'জব পোস্টে সেলস আর ডিজাইন টিমের সাথে কাজের কথা আছে। তারা দেখতে চান আপনি মতামত না, ডেটা দিয়ে মতভেদ মেটান।',
    how: 'Use STAR. The weekly Excel report is your story: what the disagreement was, the numbers you brought, and how sales now plans Eid stock from it.',
    howBn: 'STAR কাঠামো ব্যবহার করুন। সাপ্তাহিক Excel রিপোর্টটাই আপনার গল্প: মতভেদটা কী ছিল, কোন সংখ্যা এনেছিলেন, আর এখন সেলস কীভাবে সেটা দেখে ঈদের স্টক ঠিক করে।',
  },
];
