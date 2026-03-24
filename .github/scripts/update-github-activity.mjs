/**
 * Same behavior as jamesgeorge007/github-activity-readme, run on Node 24
 * so workflows avoid Node 20 action deprecation warnings.
 */
import fs from "fs";
import { spawn } from "child_process";

const capitalize = (str) => str.slice(0, 1).toUpperCase() + str.slice(1);

const toUrlFormat = (item) => {
  if (typeof item !== "object") {
    return `[${item}](https://github.com/${item})`;
  }
  if (Object.hasOwnProperty.call(item.payload, "comment")) {
    return `[#${item.payload.issue.number}](${item.payload.comment.html_url})`;
  }
  if (Object.hasOwnProperty.call(item.payload, "issue")) {
    return `[#${item.payload.issue.number}](${item.payload.issue.html_url})`;
  }
  if (Object.hasOwnProperty.call(item.payload, "pull_request")) {
    const prNumber = item.payload.pull_request.number;
    const repoName = item.repo.name;
    return `[#${prNumber}](https://github.com/${repoName}/pull/${prNumber})`;
  }
  if (Object.hasOwnProperty.call(item.payload, "release")) {
    const release = item.payload.release.name || item.payload.release.tag_name;
    return `[${release}](${item.payload.release.html_url})`;
  }
};

const exec = (cmd, args = []) =>
  new Promise((resolve, reject) => {
    const app = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    if (app.stdout) {
      app.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    if (app.stderr) {
      app.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }
    app.on("close", (code) => {
      if (code !== 0 && !stdout.includes("nothing to commit")) {
        return reject(new Error(`Exit code: ${code}\n${stdout}\n${stderr}`));
      }
      return resolve(stdout);
    });
    app.on("error", (err) => reject(err));
  });

const GH_USERNAME =
  process.env.GH_USERNAME || process.env.GITHUB_REPOSITORY_OWNER;
const COMMIT_NAME = process.env.COMMIT_NAME || "github-actions[bot]";
const COMMIT_EMAIL =
  process.env.COMMIT_EMAIL ||
  "41898282+github-actions[bot]@users.noreply.github.com";
const COMMIT_MSG =
  process.env.COMMIT_MSG || ":zap: Update README with the recent activity";
const MAX_LINES = parseInt(process.env.MAX_LINES || "5", 10);
const TARGET_FILE = process.env.TARGET_FILE || "README.md";
const EMPTY_COMMIT_MSG =
  process.env.EMPTY_COMMIT_MSG ||
  ":memo: empty commit to keep workflow active after 60 days of no activity";
const FILTER_RAW =
  process.env.FILTER_EVENTS ||
  "IssueCommentEvent,IssuesEvent,PullRequestEvent,ReleaseEvent";
const FILTER_EVENTS = FILTER_RAW.split(",").map((s) => s.trim());

const serializers = {
  IssueCommentEvent: (item) =>
    `🗣 Commented on ${toUrlFormat(item)} in ${toUrlFormat(item.repo.name)}`,
  IssuesEvent: (item) => {
    let emoji = "ℹ️";
    switch (item.payload.action) {
      case "opened":
        emoji = "❗";
        break;
      case "reopened":
        emoji = "🔓";
        break;
      case "closed":
        emoji = "🔒";
        break;
    }
    return `${emoji} ${capitalize(item.payload.action)} issue ${toUrlFormat(
      item,
    )} in ${toUrlFormat(item.repo.name)}`;
  },
  PullRequestEvent: (item) => {
    let emoji = "ℹ️";
    let actionText = capitalize(item.payload.action);
    switch (item.payload.action) {
      case "opened":
        emoji = "💪";
        actionText = "Opened";
        break;
      case "closed":
        emoji = "❌";
        actionText = "Closed";
        break;
      case "merged":
        emoji = "🎉";
        actionText = "Merged";
        break;
    }
    return `${emoji} ${actionText} PR ${toUrlFormat(item)} in ${toUrlFormat(item.repo.name)}`;
  },
  ReleaseEvent: (item) =>
    `🚀 ${capitalize(item.payload.action)} release ${toUrlFormat(
      item,
    )} in ${toUrlFormat(item.repo.name)}`,
};

const commitFile = async (emptyCommit = false) => {
  await exec("git", ["config", "user.email", COMMIT_EMAIL]);
  await exec("git", ["config", "user.name", COMMIT_NAME]);
  if (emptyCommit) {
    await exec("git", ["commit", "--allow-empty", "-m", EMPTY_COMMIT_MSG]);
  } else {
    await exec("git", ["add", TARGET_FILE]);
    await exec("git", ["commit", "-m", COMMIT_MSG]);
  }
  await exec("git", ["push"]);
};

const createEmptyCommit = async () => {
  const lastCommitDate = await exec("git", [
    "--no-pager",
    "log",
    "-1",
    "--format=%ct",
  ]);
  const commitDate = new Date(parseInt(lastCommitDate.trim(), 10) * 1000);
  const diffInDays = Math.round(
    (Date.now() - commitDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffInDays > 50) {
    console.log("Create empty commit to keep workflow active");
    await commitFile(true);
    return "Empty commit pushed";
  }
  return "No PullRequest/Issue/IssueComment/Release events found. Leaving README unchanged with previous activity";
};

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error("GITHUB_TOKEN is required.");
  process.exit(1);
}

const res = await fetch(
  `https://api.github.com/users/${encodeURIComponent(GH_USERNAME)}/events/public?per_page=100`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);

if (!res.ok) {
  console.error(`GitHub API error: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const events = await res.json();

const content = events
  .filter(
    (event) =>
      Object.hasOwn(serializers, event.type) &&
      FILTER_EVENTS.includes(event.type),
  )
  .slice(0, MAX_LINES)
  .map((item) => serializers[item.type](item));

const readmeContent = fs.readFileSync(`./${TARGET_FILE}`, "utf-8").split("\n");

let startIdx = readmeContent.findIndex(
  (line) => line.trim() === "<!--START_SECTION:activity-->",
);

if (startIdx === -1) {
  console.error(
    "Couldn't find the <!--START_SECTION:activity--> comment. Exiting!",
  );
  process.exit(1);
}

const endIdx = readmeContent.findIndex(
  (line) => line.trim() === "<!--END_SECTION:activity-->",
);

if (content.length === 0) {
  console.log("Found no activity.");
  try {
    const message = await createEmptyCommit();
    console.log(message);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  process.exit(0);
}

if (content.length < 5) {
  console.log("Found less than 5 activities");
}

if (startIdx !== -1 && endIdx === -1) {
  startIdx++;
  content.forEach((line, idx) => {
    readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`);
  });
  readmeContent.splice(
    startIdx + content.length,
    0,
    "<!--END_SECTION:activity-->",
  );
  fs.writeFileSync(`./${TARGET_FILE}`, readmeContent.join("\n"));
  try {
    await commitFile();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log("Wrote to README");
  process.exit(0);
}

const oldContent = readmeContent.slice(startIdx + 1, endIdx).join("\n");
const newContent = content
  .map((line, idx) => `${idx + 1}. ${line}`)
  .join("\n");

if (oldContent.trim() === newContent.trim()) {
  console.log("No changes detected");
  process.exit(0);
}

startIdx++;

const readmeActivitySection = readmeContent.slice(startIdx, endIdx);
if (!readmeActivitySection.length) {
  content.some((line, idx) => {
    if (!line) {
      return true;
    }
    readmeContent.splice(startIdx + idx, 0, `${idx + 1}. ${line}`);
  });
  console.log(`Wrote to ${TARGET_FILE}`);
} else {
  let count = 0;
  readmeActivitySection.some((line, idx) => {
    if (!content[count]) {
      return true;
    }
    if (line !== "") {
      readmeContent[startIdx + idx] = `${count + 1}. ${content[count]}`;
      count++;
    }
  });
  console.log(`Updated ${TARGET_FILE} with the recent activity`);
}

fs.writeFileSync(`./${TARGET_FILE}`, readmeContent.join("\n"));

try {
  await commitFile();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log("Pushed to remote repository");
