const sqlite = require('sqlite-async');
const server = require('server');
const fetch = require('node-fetch');
const parseLink = require('parse-link-header');

const {get, post} = server.router;
const {render, json, redirect, status} = server.reply;
const rootUrl = 'https://api.github.com';
const opts = {
	'headers': {
		'Authorization': 'bearer xx',
		'content-type': 'application/json'
	}
};

let db; // initialized at app startup

// create tables for orgs, repos, contributors (public and otherwise...)
const initDb = () => db.transaction(db => {
	return Promise.all([
		db.run('CREATE TABLE orgs(id INTEGER PRIMARY KEY, login TEXT)'),
		db.run('CREATE TABLE repos(id INTEGER PRIMARY KEY, name TEXT, stars INTEGER, forks INTEGER, org_id INTEGER, UNIQUE(id, org_id))'),
		db.run('CREATE TABLE users(id INTEGER PRIMARY KEY, login TEXT)'),
		db.run('CREATE TABLE repo_contributors(repo_id INTEGER, user_id INTEGER, contributions INTEGER, UNIQUE(repo_id, user_id))'),
		db.run('CREATE TABLE org_public_members(org_id INTEGER, user_id INTEGER, UNIQUE(org_id, user_id))')
	]);
});


const insertOrgPublicMembers = async (org_id, members) => {
	//  (org_id, user_id)
	let stmt = await db.prepare('INSERT OR IGNORE INTO org_public_members (org_id, user_id) VALUES (?, ?)');
	return db.transaction(db => 
		Promise.all(members.map(member => stmt.run(org_id, member.user_id)))
	);
};

const insertRepoContributors = async (repo_id, contributors) => {
	// (repo_id, user_id, contributions) 
	let stmt = await db.prepare('INSERT OR IGNORE INTO repo_contributors (repo_id, user_id, contributions) VALUES (?, ?, ?)');
	return db.transaction(db =>
		Promise.all(contributors.map(rc => stmt.run(repo_id, rc.user_id, rc.contributions)))
	);
};

const insertOrg = async (id, login) => {
	let stmt = await db.prepare('INSERT INTO orgs (id, login) VALUES (?, ?)');
	return stmt.run(id, login.toLowerCase());
};

const selectOrgByName = async name => {
	let query = `SELECT id, login FROM orgs WHERE login = ?`;
	let row = await db.get(query, [name.toLowerCase()]);
	return row ? {id: row.id, login: row.login} : {};
};

const selectOrgById = async id => {
	let query = `SELECT id, login FROM orgs WHERE id = ?`;
	let row = await db.get(query, [id]);
	return row ? {id: row.id, login: row.login} : {};
};

const insertRepos = async (org_id, repos) => {
	// (id, name, stars, forks)
	let stmt = await db.prepare('INSERT INTO repos (id, name, stars, forks, org_id) VALUES (?, ?, ?, ?, ?)');
	return db.transaction( db =>
		Promise.all(repos.map(repo => stmt.run(repo.id, repo.name, repo.stars, repo.forks, org_id)))
	);
};

const selectReposForOrg = async org_id => {
	console.log("select repos for org " + org_id);
	let stmt = await db.prepare('SELECT id, name, stars, forks, (SELECT SUM(contributions) FROM repo_contributors WHERE repo_contributors.repo_id = repos.id) AS contributions FROM repos WHERE org_id = ?');
	let stmt1 = await stmt.bind(org_id);
	let rows = await stmt1.all();
	return rows.map(r => {return {id: r.id, name: r.name, stars: r.stars, forks: r.forks, contributions: r.contributions}});
}

const insertUsers = async users => {
	let stmt = await db.prepare('INSERT  OR IGNORE INTO users (id, login) VALUES (?,?)');
	return db.transaction(db => Promise.all(users.map(user => stmt.run(user.id, user.login))));
};

const selectUsers = async () => {
	let stmt = await db.prepare('SELECT * from users');
	let rows = await stmt.all();
	return rows.map(r => { return {id: r.id, login: r.login}});
};

// returns [link, data]
// where link has {next: .., prev: .., last: ..}
const getPaginatedData = async url => {
	let resp = await fetch(url, opts);
	let data = await resp.json();
	console.log("data: " + data);
	let link = parseLink(resp.headers.get('Link')); // can be null, no link in header
	//console.log("url" + url);
	//console.log("data? " + data);
	return [link, data];
};


const getOrg = async org => {
	let url = `${rootUrl}/orgs/${org}`;
	let resp = await fetch(url, opts);
	let data = await resp.json();
	return {id: data.id, login: data.login};
};

const getPublicMembersForOrg = async (org_id, publicMembersUrl) => {
	console.log("fetching " + publicMembersUrl);
	let [link, members] = await getPaginatedData(publicMembersUrl);
	let _1 = await insertUsers(members.map(m => {return {id: m.id, login: m.login}}));
	let _2 = await insertOrgPublicMembers(org_id, members.map(m => {return {user_id: m.id}}));
	if (link && link.next) {
		return getPublicMembersForOrg(org_id, link.next.url);
	}
	else {
		console.log("finished loading members for " + publicMembersUrl);
		return;
	}
};

const getRepoContributors = async (repo_id, contributors_url) => {
	//console.log("REPO ID: " + repo_id + ", CONTRIBUTOR URL " + contributors_url);
	let [link, contributors] = await getPaginatedData(contributors_url);
	let _1 = await insertUsers(contributors.map(rc=> {return {id: rc.id, login: rc.login}}));
	let _2 = await insertRepoContributors(repo_id, contributors.map(rc => {return {user_id: rc.id, contributions: rc.contributions}}));
	if (link && link.next) {
		return getRepoContributors(repo_id, link.next.url);
	}
	else {
		console.log("finished loading contibutors for repo " + contributors_url);
		return;
	}
};

const getReposContribs = async contribs => {
	let next = contribs.shift();
	//console.log("next repo contrib: " + next);
	let _1 = await getRepoContributors(next.id, next.url);
	if (contribs.length > 0) {
		return getReposContribs(contribs);
	}
	else {
		console.log("finished loading contributors for a bunch of repos");
		return;
	}
};

const getReposForOrg = async (org_id, orgReposUrl) => {
	let [link, repos] = await getPaginatedData(orgReposUrl);
	let _1 = await insertRepos(org_id, repos.map(r => {return {id: r.id, name: r.name, stars: r.stargazers_count, forks: r.forks_count}}));
	// one transaction at a time in sqlite
	let _2 = await getReposContribs(repos.map(r => {return {id: r.id, url: r.contributors_url}}));
	if (link && link.next) {
		return getReposForOrg(org_id, link.next.url);
	}
	else {
		console.log("finished loading repos for " + orgReposUrl);
	}
};

// quick hack, should be in DB
// {org : {scraping: true, completed: false, max_repos: 200, max_members: 100}}  eg.
const scrapeStatuses = new Map();

// triggered from browser after initial load of org
const fetchOrg = async ctx => {
	let org_id = ctx.params.id; // Lower case??
	let org = await selectOrgById(org_id); 
	console.log("fetch more data for " + org.id + ", " + org.login)
	let _1 = await getPublicMembersForOrg(org.id, `${rootUrl}/orgs/${org.login}/public_members`);
	let _3 = await getReposForOrg(org.id, `${rootUrl}/orgs/${org.login}/repos`);
	console.log("FINISHED LOADING DATA FOR " + org.login);
	scrapeStatuses.set(org.login, true);
	let repos = await selectReposForOrg(org.id);
	return json(repos);
};

// first we look for data, if it exists, return it
// if not return message and trigger load, then poll the get.
const showOrg = async ctx => {
	console.log("Looking for ORG " + ctx.params.name);
	let org_name = ctx.params.name.toLowerCase();
	if (scrapeStatuses.get(org_name) == undefined) {
		scrapeStatuses.set(org_name, false); // its there but not finished
		console.log("fetch org " + org_name);
		let org = await getOrg(org_name); // await getReposForOrg(ctx.data.org));
		console.log("\ninserting ORG: " + org.id + ", " + org.login);
		let _1 = await insertOrg(org.id, org.login);
		return json({'message': 'loading data', 'org_id': org.id});
	}
	else if (! scrapeStatuses.get(org_name)) {
		let org = await selectOrgByName(org_name);
		return json({'message': 'loading data', 'org_id': org.id});
	}
	else { // should have the data
		let org = await selectOrgByName(org_name); // could tighten this up to one query
		//let users = await selectUsers();
		let repos = await selectReposForOrg(org.id);
		return json(repos);
	}
};

const run = async () => {
	console.log("STARTING");
	db = await sqlite.open(':memory:');
	let _ = await initDb();
	console.log("Should have a db");

// finally set up server
	server({ security: { csrf: false } },[
		get('/', ctx => render('index.html')),
		get('/org/:name', showOrg), // login instead of id?
		post('/org/:id', fetchOrg),
		get('/test', ctx => "Helloo!!")
	]);
};

run();

