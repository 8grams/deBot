const { exec } = require('child_process');

function mention(id) {
    if(typeof id === 'string') {
        return `<@!${id}>`
    }
    return '';
}

async function executeCommand(command){
    const promise = new Promise((resolve,reject) => {
        exec(command, (err, stdout) => {
            if(err) {
                console.log(`error on command ${command}`, err);
                reject(err);
                return;
            }
            resolve(stdout);
        });
    })
    return promise;
}

module.exports = {
    mention,
    executeCommand
};