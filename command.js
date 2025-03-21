const { executeCommand } = require('./helper');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const Git = require('nodegit');
const yaml = require('yaml');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(process.env.SQLITE_URL);

const gitlabUrl = process.env.GITLAB_URL;
const gitlabApi = axios.create({
    baseURL: `${gitlabUrl}/api/v4/`,
    timeout: 5000,
    headers: {
        'PRIVATE-TOKEN': process.env.GITLAB_TOKEN,
        'Content-Type': 'application/json'
    },
});

const availableProjects = getAvailableProjects();

const channelNotif = process.env.DISCORD_RUNTIME_CHANNEL;
const prefixCommand = process.env.DISCORD_PREFIX_COMMAND;

async function makeReleaseNote(projectID){
    let notes = `# Release Notes\n\n`;
    try {
        const response = await gitlabApi.get(`/projects/${projectID}/repository/commits?ref_name=develop`);
        const data = response.data;
        for(let i = 0; i < data.length; i++){
            const d = data[i];
            notes += `####  [${d.author_name}]\n ${d.message}`;
        }
    } catch(err) {
        console.log('Error on make Release Note ')
        throw err;
    }
    return notes;
}

async function getTagNameBasedOnSemver(project, tag_name) {
    const listTags = await gitlabApi.get(`/projects/${project.id}/repository/tags`, {
        params: {
            order_by: "updated",
            sort: "desc"
        }
    });

    const tags = listTags.data;
    const regexVersion = /^v(\d+)\.(\d+)\.(\d+)$/;
    let matchData = null, currTag = null, i = 0, versionObj = null;
    do {
        currTag = tags[i];
        if(!currTag) {
            break;
        }
        const name = currTag.name;
        matchData =  name.match(regexVersion);
        if(matchData) {
            versionObj = {};
            versionObj.major = Number(matchData[1]);
            versionObj.minor = Number(matchData[2]);
            versionObj.patch = Number(matchData[3]);
        }
        i++;
    } while(!versionObj && i < tags.length);

    if(!versionObj) {
        return 'v1.0.0';
    }

    switch(tag_name) {
        case 'major':
            versionObj.major++;
            versionObj.minor = 0;
            versionObj.patch = 0;
            break;
        case 'minor':
            versionObj.minor++;
            versionObj.patch = 0;
            break;
        case 'patch':
            versionObj.patch++;
            break;
    }
    return `v${versionObj.major}.${versionObj.minor}.${versionObj.patch}`;
}

async function getStatusFunction(msg, params) {
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }

    const projectName = params[0];
    const environment  = params[1];
    const action = 'deployment';
    const namespace = environment;

    try {
        const status = await executeCommand(`kubectl -n ${namespace} get pods --selector=app=${projectName}`);
        let description = await executeCommand(`kubectl -n ${namespace} get ${action} ${projectName} -o yaml| grep image:`);
        return msg.reply(status + "\n" + description.trim());
    } catch(err) {
        console.log(`Error on get status ${projectName}`, { err });
        return msg.reply(`There is error on getting status ${projectName}, Please try again later or you can check log on server`);
    }
}

async function restartFunction(msg, params) {
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }

    const projectName = params[0];
    const environment  = params[1] ?? 'staging';

    if(!projectName) {
        return msg.reply(`Please provide project_name, command: **${prefixCommand}!restart** *<project_name>* *<environment>*`);
    }

    if(!environment) {
        return msg.reply(`Please provide environment, command: **${prefixCommand}!restart** *<project_name>* *<environment>*`);
    }

    if (!(availableProjects.indexOf(projectName) > -1)) {
        return msg.reply('Available projects are ' + availableProjects.join(", "));
    }

    const action = 'deployment';
    const namespace = environment;

    try {
        await executeCommand(`kubectl -n ${namespace} rollout restart ${action} ${projectName}`);
    } catch(err) {
        console.log(`Error on restarting ${projectName}`, { err });
        return msg.reply(`There is error when restarting ${projectName}, Please try again later or you can check log on server`);
    }

    return msg.reply(`Restarting ${projectName} on ${environment}. To get status about the pods, run: **${prefixCommand}!status** ${projectName} ${environment}`)
}

async function deployFunction(msg, params){
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }
    const projectName = params[0];
    const version = params[1];
    const environment  = params[2];
    if(!projectName) {
        return msg.reply(`Please provide project_name, command: **${prefixCommand}!deploy** *<project_name>* *<version>* *<environment>*`);
    }

    if(!version) {
        return msg.reply(`Please provide version, command: **${prefixCommand}!deploy** *<project_name>* *<version>* *<environment>*`);
    }

    if(!environment) {
        return msg.reply(`Please provide environment, command: **${prefixCommand}!deploy** *<project_name>* *<version>* *<environment>*`);
    }

    // set trigger token
    const { groupName, cspUrl, gitopsName} = getProjectDetail(projectName);

    const repoPath = `/opt/data/${gitopsName}`;
    const p = path.resolve(repoPath);
    try{
        if(!fs.existsSync(p)) {
            await executeCommand(`git clone ${cspUrl} ${p}`);
        }

        await executeCommand(`cd ${repoPath} && git config --global --add safe.directory ${repoPath} && git pull origin master`);

        const repo = await Git.Repository.open(p);
        let filePath, relativePath;
        if(environment === 'production') {
            relativePath = `k8s/applications/${projectName}/overlays/production/manifests.yml`
            filePath = path.resolve(p,`k8s/applications/${projectName}/overlays/production/manifests.yml`);
        } else if(environment === 'staging') {
            relativePath = `k8s/applications/${projectName}/base/manifests.yml`
            filePath = path.resolve(p, `k8s/applications/${projectName}/base/manifests.yml`);
        } else {
            return msg.reply(`Please provide environment production or staging, command: **${prefixCommand}!deploy** *<project_name>* *<version>* *<environment>*`);
        }

        if(!fs.existsSync(filePath)) {
            return msg.reply(`Repository ${projectName} not available yet`);
        }

        const contentYAML = fs.readFileSync(filePath, 'utf8');
        const contents = yaml.parseAllDocuments(contentYAML);
        const content = contents[0].contents;
        const containers = content.get('spec').get('template').get('spec').get('containers');
        const container = containers.get(0);
        container.set('image', `registry.gitlab.com/${groupName}/${projectName}:${version}`);

        let output = '';
        contents.forEach(c => {
            output += `---\n${yaml.stringify(c)}`;
        });
        fs.writeFileSync(filePath, output);
        await executeCommand(`cd ${repoPath} && git pull origin master`);
        const indexRepo = await repo.refreshIndex();
        await indexRepo.remove(relativePath, 0);
        await indexRepo.addByPath(relativePath);
        await indexRepo.write();
        const oid = await indexRepo.writeTree();
        const author = await repo.defaultSignature();
        const committer = await repo.defaultSignature();
        const parent = await repo.getHeadCommit();
        await repo.createCommit('HEAD', author, committer, `Deploy ${projectName} ${version} on ${environment}`, oid, [parent]);
        await executeCommand(`cd ${repoPath} && git push origin master`);

        return msg.reply(`**Deploy** ${projectName} ${version} is ***in progress***`);
    } catch(err) {
        console.log({ err });
        return msg.reply(`Error when deploy project, Please try again later`);
    }
}

async function buildFunction(msg, params){
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }

    const projectName = params[0];
    const tagName = params[1];

    if(!tagName) {
        return msg.reply(`Please provide tag_name, command: **${prefixCommand}!build** *<project_name>* *<tag_name>*`);
    }

    if(!projectName) {
        return msg.reply(`Please provide project_name, command: **${prefixCommand}!build** *<project_name>* *<tag_name>*`);
    }

    const { groupId, groupName, pipelineToken } = getProjectDetail(projectName);

    if(pipelineToken == 'wrong') {
        return msg.reply(`Project or Tag not found.`);
    }

    try {
        // check project
        const projectRes = await gitlabApi.get(`/groups/${groupId}/projects`, {
            params: {
                search: projectName,
            }
        });
        const project = projectRes.data[0];
        if(!project) {
            return msg.reply(`Project ${projectName} not found`);
        }

        // check tag
        const tagRes = await gitlabApi.get(`/projects/${project.id}/repository/tags`, {
            params: {
                search: tagName,
            }
        });
        const tag = tagRes.data[0];
        if(!tag) {
            return msg.reply(`Tag ${tagName} on ${projectName} not found`);
        }

        await gitlabApi.post(`/projects/${project.id}/trigger/pipeline`, {}, {
            params: {
                token: pipelineToken,
                ref: tagName,
                "variables[BY_TRIGGER]": 'true'
            },
        });

        msg.reply(`**Build** ${projectName} ${tagName} is ***in progress***. Check this pipeline on ${gitlabUrl}/${groupName}/${projectName}/-/pipelines`);
    } catch(err) {
        console.log('Error on build', err);
        msg.reply(`Error on build. Please try again later`);
    }
}

// ${prefixCommand}!release patch core
// ${prefixCommand}!release minor core
// ${prefixCommand}!release major core
// ${prefixCommand}!release v1.2.5-hotfix core
// ${prefixCommand}!release v1.2.5-hotfix core --branch=master
async function releaseFunction(msg, params){
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }

    const tagName = params[0];
    const projectName = params[1];
    const availableTags = ['major', 'minor', 'patch'];

    if(!tagName) {
        return msg.reply(`Please provide tag_name, command: **${prefixCommand}!release** *<tag_name>* *<project_name>* *<env>*`);
    }

    if(!projectName) {
        return msg.reply(`Please provide project_name, command: **${prefixCommand}!release** *<tag_name>* *<project_name>* *<env>*`);
    }

    const tagNameLowe = tagName.toLowerCase();

    // check branch
    let branch = 'develop';
    params.forEach(val => {
        let opts = val.split("=");
        if (opts[0] === "--branch") {
            branch = opts[1];
        }
    });

    try {
        const projectRes = await gitlabApi.get(`/groups/${groupId}/projects`, {
            params: {
                search: projectName,
            }
        });
        const project = projectRes.data[0];
        if(!project) {
            return msg.reply(`Project ${projectName} not found`);
        }
        let tagVersion = tagNameLowe;

        // comment this if you want to automatically generate release version based on semver
        if(availableTags.includes(tagNameLowe)) { // automatically generate tag name based on semver
            tagVersion = await getTagNameBasedOnSemver(project, tag_name);
        }

        await gitlabApi.post(`/projects/${project.id}/repository/tags`, {}, {
            params: {
                tag_name: tagVersion,
                ref: branch,
            },
        });
        const notes = await makeReleaseNote(project.id);
        await gitlabApi.post(`/projects/${project.id}/releases`, {
            name: tagVersion,
            tag_name: tagVersion,
            description: notes
        })
        msg.reply(`Release ${tag_name} success`);
    } catch(err) {
        console.log('Error on release', err);
        msg.reply(`Error on release, Please try again later`);
    }
}

// ${prefixCommand}!command core staging --command="php artisan list"
async function runCommand(msg, params, query) {
    if(msg.channel.name?.toLowerCase() !== channelNotif) {
        return;
    }

    const projectName = params[0];
    const environment = params[1];
    const cmd = query.command;
    const namespace = environment;

    try {
        // get one of the running pods
        let pod = await executeCommand(`kubectl -n ${namespace} get pod -l app=${projectName} --field-selector=status.phase==Running -o jsonpath="{.items[0].metadata.name}"`);
        let content = await executeCommand(`kubectl -n ${namespace} exec ${pod.trim()} -- ${cmd}`)
        content = content.substring(0, 1990) + "..";
        return msg.reply(content);
    } catch(err) {
        console.log(`Error on get status ${projectName}`, { err });
        return msg.reply(`There is error on getting status ${projectName}, Please try again later or you can check log on server`);
    }
}

async function refreshCurrentContext(cloudCluster) {
    await executeCommand(`kubectl config use-context ${cloudCluster}`);
}

function getProjectDetail(projectName) {
    // get project detail
    const pdQuery = db.prepare(`SELECT a.name, a.group_name, a.group_id, a.pipeline_token, a.csp_folder, b.name as gitops_name, b.argocd_server_url, b.argocd_token, b.csp_url FROM apps as a join gitops as g on a.gitops_id = g.id WHERE apps.name = ${projectName}`);
    const rows = pdQuery.all();

    // construct object from rows
    return rows.map(row => ({
        groupId: row.group_id,
        groupName: row.group_name,
        pipelineToken: row.pipeline_token,
        cspUrl: row.csp_url,
        cspFolder: row.csp_folder,
        gitopsName: row.gitops_name,
        argocdServerUrl: row.argocd_server_url,
        argocdToken: row.argocd_token
    }));
}

async function setKubeContext(context) {
    await executeCommand(`kubectl config use-context ${context}`);
}

async function syncFunction(msg, params) {
    if(msg.channel.name.toLowerCase() !== channelNotif) {
        return;
    }

    const projectName = params[0];
    const environment  = params[1];

    const { argocdServerUrl, argocdToken } = getProjectDetail(projectName);

    if(!projectName) {
        return msg.reply(`Please provide project_name, command: **${prefixCommand}!restart** *<project_name>* *<environment>*`);
    }

    if(!environment) {
        return msg.reply(`Please provide environment, command: **${prefixCommand}!restart** *<project_name>* *<environment>*`);
    }

    if (!(availableProjects.indexOf(projectName) > -1)) {
        return msg.reply('Available projects are ' + availableProjects.join(", "));
    }

    try {
        // login to argocd
        await executeCommand(`argocd login ${argocdServerUrl} --auth-token ${argocdToken}`);
        await executeCommand(`argocd app sync ${projectName}-${environment} --server ${argocdServerUrl} --async`);
    } catch(err) {
        console.log(`Error refresh ${projectName} on ${environment}`, { err });
        return msg.reply(`There is error when refreshing ${projectName} on ${environment}, Please try again later or you can check log on server`);
    }

    return msg.reply(`Refreshing ${projectName} on ${environment}. To get status about the pods, run: **${prefixCommand}!status** ${projectName} ${environment}`)
}

// query for available projects
function getAvailableProjects() {
    const prQuery = db.prepare('SELECT name FROM apps');
    const rows = prQuery.all();
    return rows.map(row => row.name);
}

module.exports = {
    deployFunction,
    releaseFunction,
    restartFunction,
    getStatusFunction,
    buildFunction,
    runCommand,
    syncFunction,
    gitlabApi,
};
