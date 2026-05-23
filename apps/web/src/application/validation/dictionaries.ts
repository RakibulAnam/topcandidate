// Word lists used by the gibberish detector to "rescue" tokens that look
// suspect by heuristics but are real words. Three lists by audience:
//
//   - ENGLISH: top common English + resume/professional verbs and nouns
//   - TECH:    programming languages, frameworks, tools, SaaS products
//   - BANGLISH: romanized Bengali words common in Bangladeshi CVs and chat
//
// All entries are lowercase. Exposed as a single Set for O(1) lookup; the
// detector only consults this when a token has already passed the cheap
// shape checks.
//
// NOTE: This is hand-curated, not exhaustive. The detector is designed to
// give the benefit of the doubt — unknown technical jargon (e.g. "kubernetes",
// proper nouns, niche stack names) should pass the heuristics on their own
// since they have normal vowel/consonant distributions.

const ENGLISH = [
    // articles, pronouns, conjunctions, prepositions
    'a', 'an', 'the', 'and', 'or', 'but', 'so', 'if', 'as', 'is', 'am', 'are',
    'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'do', 'does',
    'did', 'doing', 'done', 'will', 'would', 'shall', 'should', 'can', 'could',
    'may', 'might', 'must', 'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
    'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers', 'it',
    'its', 'they', 'them', 'their', 'theirs', 'this', 'that', 'these', 'those',
    'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how',
    'of', 'in', 'on', 'at', 'by', 'for', 'from', 'with', 'about', 'against',
    'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'to', 'up', 'down', 'over', 'under', 'again', 'further', 'then', 'once',
    'here', 'there', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'not', 'nor', 'only', 'own', 'same', 'than',
    'too', 'very', 'just', 'now', 'also', 'yes', 'ok', 'okay',

    // common verbs (plus common irregular forms)
    'go', 'goes', 'went', 'going', 'gone',
    'get', 'gets', 'got', 'getting', 'gotten',
    'make', 'makes', 'made', 'making',
    'take', 'takes', 'took', 'taking', 'taken',
    'see', 'saw', 'seeing', 'seen',
    'come', 'came', 'coming',
    'know', 'knew', 'knowing', 'known',
    'think', 'thought', 'thinking',
    'look', 'looked', 'looking',
    'want', 'wanted', 'wanting',
    'give', 'gave', 'given', 'giving',
    'use', 'used', 'using', 'uses',
    'find', 'found', 'finding',
    'tell', 'told', 'telling',
    'ask', 'asked', 'asking',
    'work', 'worked', 'working', 'works',
    'seem', 'seemed', 'seeming',
    'feel', 'felt', 'feeling',
    'try', 'tried', 'trying',
    'leave', 'left', 'leaving',
    'call', 'called', 'calling',
    'help', 'helped', 'helping', 'helps',
    'show', 'showed', 'showing',
    'mean', 'meant', 'meaning',
    'keep', 'kept', 'keeping',
    'let', 'letting',
    'begin', 'began', 'begun',
    'start', 'started', 'starting',
    'run', 'ran', 'running',
    'move', 'moved', 'moving',
    'live', 'lived', 'living',
    'believe', 'believed', 'believing',
    'hold', 'held', 'holding',
    'bring', 'brought', 'bringing',
    'happen', 'happened', 'happening',
    'write', 'wrote', 'written', 'writing',
    'sit', 'sat', 'sitting',
    'stand', 'stood', 'standing',
    'lose', 'lost', 'losing',
    'pay', 'paid', 'paying',
    'meet', 'met', 'meeting',
    'include', 'included', 'including',
    'continue', 'continued', 'continuing',
    'set', 'setting',
    'learn', 'learned', 'learning',
    'change', 'changed', 'changing',
    'lead', 'led', 'leading',
    'understand', 'understood', 'understanding',
    'speak', 'spoke', 'spoken', 'speaking',
    'read', 'reading',
    'send', 'sent', 'sending',
    'build', 'built', 'building',
    'follow', 'followed', 'following',
    'spend', 'spent', 'spending',
    'win', 'won', 'winning',
    'open', 'opened', 'opening',

    // common nouns, adjectives, adverbs
    'time', 'year', 'years', 'day', 'days', 'week', 'weeks', 'month', 'months',
    'hour', 'hours', 'minute', 'minutes', 'second', 'seconds',
    'people', 'person', 'man', 'woman', 'men', 'women', 'child', 'children',
    'world', 'country', 'state', 'city', 'town', 'place', 'home', 'house',
    'school', 'office', 'room', 'door', 'window', 'street', 'road',
    'life', 'family', 'friend', 'friends', 'parent', 'parents',
    'father', 'mother', 'brother', 'sister', 'son', 'daughter',
    'name', 'word', 'words', 'book', 'books', 'paper', 'page', 'pages',
    'phone', 'email', 'number', 'numbers',
    'thing', 'things', 'way', 'ways', 'part', 'parts', 'side', 'sides',
    'kind', 'kinds', 'sort', 'type', 'types',
    'fact', 'idea', 'ideas', 'reason', 'reasons',
    'good', 'great', 'best', 'better', 'bad', 'worse', 'worst',
    'new', 'old', 'young', 'big', 'small', 'large', 'little',
    'long', 'short', 'high', 'low', 'right', 'wrong', 'true', 'false',
    'easy', 'hard', 'simple', 'complex',
    'first', 'last', 'next', 'previous', 'early', 'late', 'recent',
    'real', 'sure', 'clear', 'main', 'full', 'open', 'close',
    'different', 'same', 'similar', 'whole', 'every',
    'much', 'many', 'little', 'less', 'least', 'more', 'most',
    'really', 'always', 'never', 'often', 'sometimes', 'usually',
    'almost', 'maybe', 'perhaps', 'still', 'yet', 'already', 'soon',
    'today', 'tomorrow', 'yesterday',

    // resume / professional verbs
    'managed', 'manage', 'managing', 'management',
    'led', 'leading', 'leadership',
    'developed', 'developing', 'develop', 'development', 'developer',
    'designed', 'designing', 'design', 'designer',
    'created', 'creating', 'create', 'creation',
    'implemented', 'implementing', 'implement', 'implementation',
    'delivered', 'delivering', 'deliver', 'delivery',
    'launched', 'launching', 'launch',
    'achieved', 'achieving', 'achieve', 'achievement',
    'increased', 'increasing', 'increase',
    'reduced', 'reducing', 'reduce', 'reduction',
    'improved', 'improving', 'improve', 'improvement',
    'optimized', 'optimizing', 'optimize', 'optimization',
    'streamlined', 'streamlining', 'streamline',
    'automated', 'automating', 'automate', 'automation',
    'scaled', 'scaling', 'scale', 'scalable',
    'integrated', 'integrating', 'integrate', 'integration',
    'deployed', 'deploying', 'deploy', 'deployment',
    'maintained', 'maintaining', 'maintain', 'maintenance',
    'supported', 'supporting', 'support',
    'trained', 'training', 'train', 'trainer',
    'mentored', 'mentoring', 'mentor',
    'collaborated', 'collaborating', 'collaborate', 'collaboration',
    'coordinated', 'coordinating', 'coordinate', 'coordination',
    'organized', 'organizing', 'organize', 'organization', 'organizational',
    'supervised', 'supervising', 'supervise', 'supervisor',
    'directed', 'directing', 'direct', 'director',
    'executed', 'executing', 'execute', 'execution', 'executive',
    'completed', 'completing', 'complete', 'completion',
    'expanded', 'expanding', 'expand', 'expansion',
    'transformed', 'transforming', 'transform', 'transformation',
    'analyzed', 'analyzing', 'analyze', 'analysis', 'analyst',
    'evaluated', 'evaluating', 'evaluate', 'evaluation',
    'reviewed', 'reviewing', 'review',
    'identified', 'identifying', 'identify', 'identification',
    'resolved', 'resolving', 'resolve', 'resolution',
    'tested', 'testing', 'test', 'tester',
    'validated', 'validating', 'validate', 'validation',
    'monitored', 'monitoring', 'monitor',
    'measured', 'measuring', 'measure', 'measurement',
    'reported', 'reporting', 'report',
    'presented', 'presenting', 'present', 'presentation',
    'communicated', 'communicating', 'communicate', 'communication',
    'partnered', 'partnering', 'partner', 'partnership',
    'negotiated', 'negotiating', 'negotiate', 'negotiation',
    'researched', 'researching', 'research', 'researcher',

    // common professional / resume nouns
    'team', 'teams', 'project', 'projects', 'company', 'companies',
    'client', 'clients', 'customer', 'customers', 'business', 'businesses',
    'product', 'products', 'feature', 'features', 'service', 'services',
    'system', 'systems', 'platform', 'platforms', 'application', 'applications',
    'app', 'apps', 'website', 'websites', 'site', 'sites',
    'data', 'database', 'databases', 'analytics', 'metrics', 'kpi', 'kpis',
    'marketing', 'sales', 'finance', 'accounting', 'operations',
    'hr', 'human', 'resources', 'recruitment', 'hiring', 'recruiter',
    'engineer', 'engineering', 'engineers',
    'manager', 'managers', 'lead', 'senior', 'junior', 'principal', 'staff',
    'developer', 'developers', 'designer', 'designers',
    'consultant', 'consulting', 'strategist', 'strategy', 'strategic',
    'executive', 'ceo', 'cto', 'cfo', 'coo', 'vp', 'svp', 'evp',
    'president', 'founder', 'cofounder', 'owner', 'partner',
    'intern', 'internship', 'apprentice', 'fellow', 'fellowship',
    'role', 'roles', 'position', 'positions', 'job', 'jobs', 'career', 'careers',
    'experience', 'experiences', 'experienced',
    'skill', 'skills', 'skilled',
    'certification', 'certifications', 'certified', 'certificate',
    'award', 'awards', 'awarded',
    'achievement', 'achievements', 'accomplishment', 'accomplishments',
    'responsibility', 'responsibilities', 'responsible',
    'education', 'university', 'universities', 'college', 'colleges',
    'school', 'schools', 'degree', 'degrees', 'bachelor', 'bachelors',
    'master', 'masters', 'phd', 'doctorate', 'mba', 'bsc', 'msc',
    'diploma', 'gpa', 'cgpa',
    'student', 'students', 'graduate', 'graduated', 'graduating', 'graduation',
    'undergraduate', 'postgraduate', 'alumni', 'alumnus',
    'club', 'clubs', 'society', 'committee', 'volunteer', 'volunteering',
    'conference', 'conferences', 'workshop', 'workshops', 'seminar', 'seminars',
    'publication', 'publications', 'paper', 'papers', 'journal', 'journals',
    'industry', 'industries', 'sector', 'sectors',
    'startup', 'startups', 'enterprise', 'enterprises', 'corporation',
    'agency', 'agencies', 'firm', 'firms', 'organization', 'organizations',
    'department', 'departments', 'division', 'divisions',
    'budget', 'budgets', 'revenue', 'profit', 'profits', 'loss', 'losses',
    'cost', 'costs', 'investment', 'investments',
    'goal', 'goals', 'objective', 'objectives', 'target', 'targets',
    'result', 'results', 'outcome', 'outcomes', 'impact', 'impacts',
    'process', 'processes', 'procedure', 'procedures', 'workflow', 'workflows',
    'tool', 'tools', 'technology', 'technologies', 'tech', 'stack',
    'language', 'languages', 'framework', 'frameworks', 'library', 'libraries',
    'feature', 'features', 'function', 'functions', 'module', 'modules',
    'release', 'releases', 'version', 'versions',
    'user', 'users', 'audience', 'community', 'communities',
    'campaign', 'campaigns', 'event', 'events',
    'content', 'media', 'social', 'digital', 'mobile', 'web',
    'frontend', 'backend', 'fullstack', 'devops', 'cloud',
    'security', 'privacy', 'compliance', 'audit',

    // numbers / units
    'percent', 'million', 'billion', 'thousand', 'hundred',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',

    // misc filler tokens that show up in descriptions
    'using', 'used', 'including', 'while', 'within', 'across', 'among',
    'such', 'each', 'every', 'any', 'all', 'none', 'both', 'either',
    'across', 'between', 'beyond',
];

const TECH = [
    // languages
    'javascript', 'js', 'typescript', 'ts', 'python', 'py', 'java', 'kotlin',
    'swift', 'objective', 'objectivec', 'ruby', 'rails', 'php', 'go', 'golang',
    'rust', 'scala', 'clojure', 'haskell', 'elixir', 'erlang', 'lua', 'perl',
    'r', 'matlab', 'sas', 'spss', 'cpp', 'csharp', 'fsharp', 'dart', 'groovy',
    'bash', 'shell', 'powershell', 'zsh', 'sh',

    // markup / styling
    'html', 'html5', 'css', 'css3', 'sass', 'scss', 'less', 'tailwind',
    'tailwindcss', 'bootstrap', 'mui', 'material', 'chakra', 'antd',

    // frameworks / runtimes
    'react', 'reactjs', 'nextjs', 'next', 'remix', 'gatsby', 'vue', 'vuejs',
    'nuxt', 'nuxtjs', 'angular', 'svelte', 'sveltekit', 'solid', 'solidjs',
    'astro', 'qwik', 'lit',
    'node', 'nodejs', 'deno', 'bun',
    'express', 'koa', 'fastify', 'nestjs', 'hapi',
    'django', 'flask', 'fastapi', 'starlette', 'tornado',
    'spring', 'springboot', 'hibernate',
    'laravel', 'symfony', 'codeigniter', 'yii',
    'rails', 'sinatra',
    'dotnet', 'aspnet', 'blazor',
    'flutter', 'reactnative',
    'electron', 'tauri',

    // databases / storage
    'sql', 'nosql', 'postgres', 'postgresql', 'mysql', 'mariadb', 'sqlite',
    'oracle', 'mssql', 'sqlserver',
    'mongodb', 'mongo', 'redis', 'memcached', 'cassandra', 'couchbase',
    'dynamodb', 'firestore', 'supabase', 'firebase', 'planetscale', 'neon',
    'elasticsearch', 'opensearch', 'solr',
    'snowflake', 'redshift', 'bigquery', 'databricks',

    // cloud / infra / devops
    'aws', 'azure', 'gcp', 'cloudflare', 'vercel', 'netlify', 'heroku',
    'digitalocean', 'linode', 'fly', 'render',
    'kubernetes', 'k8s', 'docker', 'podman', 'containerd',
    'terraform', 'pulumi', 'cloudformation', 'ansible', 'chef', 'puppet',
    'jenkins', 'circleci', 'travis', 'github', 'gitlab', 'bitbucket',
    'argo', 'argocd', 'helm', 'istio',
    'lambda', 'fargate', 's3', 'ec2', 'rds', 'sqs', 'sns', 'eks', 'ecs',
    'cloudfront', 'route53', 'iam',
    'datadog', 'newrelic', 'sentry', 'pagerduty', 'grafana', 'prometheus',
    'splunk', 'elk', 'kibana', 'logstash',

    // protocols / formats
    'http', 'https', 'rest', 'restful', 'graphql', 'grpc', 'websocket',
    'websockets', 'webhook', 'webhooks',
    'json', 'xml', 'yaml', 'toml', 'csv', 'tsv', 'markdown', 'md',
    'jwt', 'oauth', 'oauth2', 'oidc', 'saml', 'sso',
    'tcp', 'udp', 'ip', 'dns', 'cdn', 'tls', 'ssl',

    // tools / SaaS
    'git', 'svn', 'mercurial',
    'jira', 'confluence', 'notion', 'asana', 'linear', 'trello', 'monday',
    'slack', 'teams', 'zoom', 'discord',
    'figma', 'sketch', 'invision', 'zeplin', 'photoshop', 'illustrator',
    'indesign', 'aftereffects', 'premiere', 'lightroom', 'xd', 'canva',
    'excel', 'powerpoint', 'word', 'outlook', 'sharepoint', 'onedrive',
    'gmail', 'gsuite', 'workspace', 'docs', 'sheets', 'slides',
    'salesforce', 'hubspot', 'zendesk', 'intercom', 'freshdesk',
    'stripe', 'paypal', 'square', 'braintree',
    'shopify', 'woocommerce', 'wordpress', 'wix', 'webflow', 'squarespace',
    'sap', 'oracle', 'workday', 'netsuite',
    'tableau', 'powerbi', 'looker', 'metabase', 'mode',

    // data / ML
    'pandas', 'numpy', 'scipy', 'matplotlib', 'seaborn', 'plotly',
    'sklearn', 'scikit', 'tensorflow', 'pytorch', 'keras', 'jax',
    'huggingface', 'transformers', 'spacy', 'nltk',
    'spark', 'hadoop', 'hive', 'pig', 'kafka', 'flink', 'airflow', 'dagster',
    'dbt', 'fivetran', 'segment',
    'ml', 'ai', 'llm', 'nlp', 'cv', 'rag',

    // testing / build
    'jest', 'mocha', 'jasmine', 'cypress', 'playwright', 'puppeteer',
    'selenium', 'webdriver', 'pytest', 'unittest', 'junit', 'rspec',
    'webpack', 'vite', 'rollup', 'parcel', 'esbuild', 'babel', 'turbopack',
    'npm', 'yarn', 'pnpm', 'pip', 'poetry', 'cargo', 'maven', 'gradle',
    'eslint', 'prettier', 'stylelint',

    // OS / general
    'linux', 'ubuntu', 'debian', 'centos', 'redhat', 'fedora', 'arch',
    'macos', 'windows', 'ios', 'android',
    'vscode', 'intellij', 'pycharm', 'webstorm', 'eclipse', 'vim', 'emacs',
    'sublime', 'atom',

    // generic
    'api', 'apis', 'sdk', 'sdks', 'cli', 'gui', 'ui', 'ux',
    'frontend', 'backend', 'fullstack', 'devops', 'mlops', 'sre',
    'qa', 'qe', 'sde', 'sdet',
    'ci', 'cd', 'cicd',
    'mvp', 'poc', 'pov', 'roi', 'kpi', 'okr', 'okrs', 'sla', 'slo',
    'b2b', 'b2c', 'saas', 'paas', 'iaas',
];

// Romanized Bengali words common in Bangladeshi CVs and conversation. Curated
// to cover family/relations, common verbs/conjugations, food, time, places,
// and frequent filler words. Many have alternate spellings (bhalo/valo,
// naam/nam, dhonnobad/dhannobad) — both are listed where common.
const BANGLISH = [
    // pronouns
    'ami', 'amar', 'amake', 'amra', 'amader',
    'tumi', 'tomar', 'tomake', 'tomra', 'tomader',
    'tui', 'tor', 'toke', 'tora', 'toder',
    'apni', 'apnar', 'apnake', 'apnara', 'apnader',
    'se', 'tar', 'take', 'tara', 'tader',
    'ini', 'uni', 'eta', 'eitai', 'oita', 'eigulo', 'oigulo',

    // common verbs / forms (to be, to do, to go, to eat, to come, to want)
    'achi', 'acho', 'ache', 'achen', 'achilo', 'chilam', 'chilo', 'chile',
    'hobe', 'hoye', 'hoyeche', 'hoyechi', 'hocche', 'hoy', 'hoini', 'holo',
    'kori', 'koro', 'kore', 'koren', 'korbo', 'korte', 'korechi', 'korechilo',
    'korini', 'korben', 'korla', 'korlam', 'korlen',
    'jai', 'jao', 'jay', 'jan', 'jabo', 'gechi', 'gelo', 'jeo', 'jachhe',
    'gechilo', 'jacchen', 'jaben',
    'asi', 'aso', 'ashe', 'aschi', 'eshechi', 'eshe', 'asbo', 'asben',
    'khai', 'khao', 'khay', 'khabo', 'kheyechi', 'khachhi', 'kheye',
    'chai', 'chao', 'chay', 'chaye', 'chaichi', 'chaibo',
    'dekhi', 'dekho', 'dekhe', 'dekhechi', 'dekhbo',
    'shuni', 'shono', 'shune', 'shuneche', 'shunbo',
    'boli', 'bolo', 'bole', 'bolechi', 'bolbo', 'bolen',
    'lage', 'lagche', 'legechi', 'lagbe',

    // family
    'baba', 'maa', 'amma', 'abba', 'abbu', 'ammu',
    'bhai', 'bon', 'apu', 'apa', 'dada', 'didi',
    'chacha', 'chachi', 'mama', 'mami', 'khala', 'khalu', 'fufu', 'fufa',
    'nana', 'nani', 'dadu', 'dadi', 'thakuma', 'thakurda',
    'shami', 'stree', 'meye', 'chele',
    'poribar', 'shongshar', 'attiyo',

    // common nouns
    'naam', 'nam', 'bari', 'baari', 'desh', 'gram', 'shohor', 'jaiga',
    'rasta', 'gari', 'cycle', 'gachh', 'phul', 'pakhi',
    'kotha', 'golpo', 'kahini', 'shomoy', 'din', 'raat', 'shokal', 'bikal',
    'dupur', 'sondha', 'aaj', 'aj', 'kal', 'porshu', 'gotokal',
    'bochor', 'mash', 'shoptaho',
    'kaaj', 'kaj', 'pora', 'porashona', 'pora', 'lekha', 'porha',
    'school', 'iskool', 'college', 'university',
    'taka', 'poisha', 'dam', 'kena', 'becha',
    'khabar', 'pani', 'jol', 'cha', 'doodh', 'bhat', 'dal', 'ruti', 'roti',
    'mach', 'maach', 'gosht', 'mangsho', 'shobji', 'fol', 'mishti', 'mistanno',
    'biriyani', 'khichuri', 'pitha',
    'jamai', 'biye', 'bibah', 'shadi',

    // adjectives / adverbs
    'bhalo', 'valo', 'kharap', 'sundor', 'shundor', 'shunder',
    'boro', 'choto', 'choita', 'lomba', 'khato', 'mota', 'patla',
    'beshi', 'kom', 'onek', 'onneek', 'shob', 'shob', 'kichu', 'kichui',
    'ektu', 'ekta', 'ekjon', 'duijon', 'tinta', 'charta',
    'taratari', 'aste', 'dhire',

    // question / answer / common
    'ki', 'kibhabe', 'kemon', 'keno', 'kobe', 'kothay', 'kar', 'ke',
    'ha', 'hyan', 'hya', 'na', 'noy',
    'thik', 'accha', 'achcha', 'dhonnobad', 'dhanyabad',
    'shomossha', 'somossha', 'shahajjo', 'shahaijo',
    'bhalobasha', 'valobasha', 'mon', 'khushi', 'dukkho', 'rag',
    'lekhapora', 'parashuna',
    'bondhu', 'shathi', 'songi',
    'khub', 'beshi', 'aro', 'aaro', 'aroo',
    'jonno', 'jonyo', 'shathe', 'shange', 'theke', 'porjonto',
    'agei', 'pore', 'porey', 'majhe', 'modhye', 'kache', 'dure',
    'opor', 'niche', 'samne', 'pichone',
    'ekhane', 'okhane', 'jekhane', 'shekhane',
    'ekhon', 'tokhon', 'jokhon', 'ojkhon',

    // identity / culture
    'bangla', 'bangali', 'bangalee', 'bengali', 'bangladesh', 'bangladeshi',
    'dhaka', 'chittagong', 'chattogram', 'sylhet', 'rajshahi', 'khulna',
    'barisal', 'rangpur', 'mymensingh', 'comilla', 'cumilla',
    'eid', 'puja', 'ramadan', 'iftar', 'sehri',
    'masjid', 'mondir', 'girja',

    // common sign-offs / fillers
    'salam', 'assalamualaikum', 'walaikumassalam', 'namaskar',
    'inshallah', 'mashallah', 'alhamdulillah', 'subhanallah',
];

const buildSet = (...lists: string[][]) => {
    const set = new Set<string>();
    for (const list of lists) {
        for (const word of list) set.add(word.toLowerCase());
    }
    return set;
};

export const KNOWN_WORDS: ReadonlySet<string> = buildSet(ENGLISH, TECH, BANGLISH);
