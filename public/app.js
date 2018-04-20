let repos = []; // list of things to display
let internal_contributors = [];
let active_data = 'repos'; // default
let org_name = '';

const clear = () => {
	document.getElementById('message').innerText = '';
	document.getElementById('data_table').innerHTML = '';
	document.getElementById('radio_buttons').style.display = 'none'; // FIX THIS MESSY LOGIC!!!
};


const sortDataBy = (activeData, field) => {
	activeData.sort((a, b) => { 
		let av = a[field];
		let bv = b[field];
		if (typeof av == "string") {
			return av.localeCompare(bv);
		}
		else {
			return bv - av; // numbers desc order
		}

	});
};

const setMessage = msg => {
	document.getElementById('message').innerText = msg;
};

const showData = (sortField) => {
	let data = active_data == 'repos' ? repos : internal_contributors;
	setMessage('');
	document.getElementById('radio_buttons').style.display = '';
	sortDataBy(data, sortField);
	let keys = Object.keys(data[0]);
	let tds = row => keys.map(k => `<td>${row[k]}</td>`).join('')
	let tr = row => `<tr>${tds(row)}</tr>`
	let ths = '<tr>' + keys.map(k => `<th>${k}</th>`).join('')  + '</tr>';
	let data_rows = data.map(row => tr(row)).join('');
	let tableHTML = `<table class="sortable">${ths}${data_rows}</table>`;
	document.getElementById('data_table').innerHTML = tableHTML;
};

const getData = async () => {
	let resp = await fetch(`/org/${org_name}`); // might take a while
	if (resp.status == 404) {
		setMessage('NOT FOUND');
	}
	else if (resp.ok){
		let jsd = await resp.json();
		if (jsd.done) {
			repos = jsd.repos;
			internal_contributors = jsd.internalContributors;
			showData('name');
		}
		else if (jsd.message) {
			setMessage(jsd.message);
			setTimeout(getData, 2000);
		}
		else {
			console.log("OOPS");
			setMessage("something has gone wrong");
		}
	}
	else {
		setMessage("Other error " + resp.status);
	}
};



// ********** event handlers **************

// form submission
const onSubmit = async event => {
	clear();
	//active_data = 'repos';  TODO reset radio button to repos
	event.preventDefault();
	let el = document.getElementById('org_name');
	org_name = el.value;
	getData(); 
};

// click the ths for sorting
const clickHeader = async event => {
	let clickedEl = event.target;
	if (clickedEl.tagName == "TH") {
		let field = clickedEl.innerText;
		showData(field); // toggle back and forth ???
	}
};

// click a radio button
const toggleTable = (event) => {
	let selectedData = document.querySelector('input[name="view_type"]:checked').value;
	active_data = selectedData;
	showData('name'); 
};

// attach event handlers
document.getElementById('org_form').addEventListener('submit', onSubmit, false);

document.getElementById('data_table').addEventListener('click', clickHeader, false);

let radios = document.querySelectorAll('input[name="view_type"]');

Array.prototype.forEach.call(radios, function(radio) { radio.addEventListener('change', toggleTable, false)});