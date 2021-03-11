import isURL from "validator/lib/isURL";
import { resolve } from "path";
import { getCNAMEs, getCNAMEsFile, Cname } from "./cnames";
import fs from "fs";

import fetch from "node-fetch";

import React, { Fragment, ReactNode } from "react";
import { render, Text, Box } from "ink";
import Spinner from "ink-spinner";
import prettier from "prettier";
import deepEqual from "deep-equal";

function isValidURL(url: string): boolean {
	return isURL(url);
}

async function asyncForEach(array: any, callback: Function) {
	for (let index: number = 0; index < array.length; index++) {
		await callback(array[index], index, array);
	}
}

async function cnamesExist(): Promise<boolean> {
	try {
		await fs.promises.access(resolve(process.cwd(), "cnames_active.js"));
	} catch (e) {
		error("The file 'cnames_active.js' does not exist.", true);
		return false;
	}
	return true;
}

async function getKeyProperties(cnames: Cname[]): Promise<string[]> {
	let keys: string[] = [];
	await asyncForEach(cnames, (cname: Cname) => {
		keys.push(cname.key);
	});
	return keys;
}

function error(message: string, exit?: boolean) {
	console.log(`❌ ${message}`);
	if (exit) process.exit(1);
}

async function checkCnameNotInBlacklist(cname: string, blacklist: any) {
	await asyncForEach(blacklist, async (expression: string) => {
		if (expression == "(1/2/3/...)") {
			try {
				parseInt(cname);
			} catch (e) {
				error(`CNAME is blocklisted: '${cname}'`, true);
			}
		}
		if (expression.endsWith("(s)")) {
			expression = expression.slice(0, -3);
			if (cname == expression || cname == expression + "s") {
				error(`CNAME is blocklisted: '${cname}'`, true);
			}
		}
		if (expression.endsWith("(y/ies)")) {
			expression = expression.slice(0, -7);
			if (cname == expression + "y" || cname == expression + "ies") {
				error(`CNAME is blocklisted: '${cname}'`, true);
			}
		}
		if (expression.endsWith("(1/2)")) {
			expression = expression.slice(0, -5);
			if (cname == expression + "1" || cname == expression + "2") {
				error(`CNAME is blocklisted: '${cname}'`, true);
			}
		}
	});
}

type Props = {};

type State = {
	status: string;
	errors: string[];
	success: boolean;
	warnings: string[];
	errorCount: number;
	warningCount: number;
	summary: ReactNode;
	done: boolean;
};

class App extends React.Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = {
			status: "Starting...",
			errors: [],
			success: false,
			warnings: [],
			summary: <Box></Box>,
			errorCount: 0,
			warningCount: 0,
			done: false,
		};
	}
	error(message: string, exitAfter = true) {
		let errors: string[] = this.state.errors;
		errors.push(message);
		this.setState({
			errors: errors,
			errorCount: this.state.errorCount + 1,
		});
		if (exitAfter) this.end(1);
	}

	setStatus(message: string) {
		this.setState({
			status: message,
		});
	}

	getEmoji(emoji: string): string {
		if (!process.env.CI) {
			return emoji;
		}
		return "";
	}

	end(withCode = 0) {
		this.setState({
			summary: (
				<Box>
					<Text color="gray">
						{withCode === 0 ? (
							<Text color="green" bold>
								🎉 Success!{" "}
							</Text>
						) : (
							""
						)}
						Done with{" "}
						<Text color="red">
							{this.state.errorCount} error
							{this.state.errorCount === 0 ||
							this.state.errorCount >= 2
								? "s"
								: ""}{" "}
						</Text>
						and{" "}
						<Text color="yellow">
							{this.state.warningCount} warning
							{this.state.warningCount === 0 ||
							this.state.warningCount >= 2
								? "s"
								: ""}
						</Text>
						.
					</Text>
				</Box>
			),
			status: "Done.",
			done: true,
		});
		process.exit(withCode);
	}

	async componentDidMount() {
		const cnamesDoExist = await cnamesExist();
		if (!cnamesDoExist) {
			this.setState;
			this.error("The file 'cnames_active.js' does not exist.");
		}
		try {
			prettier.check(
				await fs.promises.readFile(
					resolve(process.cwd(), "cnames_active.js"),
					"utf-8"
				),
				{
					parser: "babel",
				}
			);
		} catch (e) {
			this.error(
				"An error occured while parsing 'cnames_active.js'. Is there a syntax error in the file?"
			);
		}
		this.setStatus("Parsing...");
		let cnames: Cname[] = [];
		try {
			cnames = await getCNAMEs(await getCNAMEsFile());
		} catch (e) {
			this.error("An error occured while parsing 'cnames_active.js'.");
		}
		let failSorting: boolean = false;
		const sortedItems: string[] = (await getKeyProperties(cnames)).sort();
		await asyncForEach(
			sortedItems,
			async (element: string, index: number) => {
				if (element !== (await getKeyProperties(cnames))[index]) {
					const correctPosition: number = sortedItems.indexOf(
						element
					);
					const itemBefore: string | false = sortedItems[
						correctPosition - 1
					]
						? sortedItems[correctPosition - 1]
						: false;
					const itemNext: string | false = sortedItems[
						correctPosition + 1
					]
						? sortedItems[correctPosition + 1]
						: false;
					const recommendation =
						itemBefore && itemNext
							? `Item should follow '${itemBefore}' and precede '${itemNext}'.`
							: itemBefore
							? `Item should follow '${itemBefore}'.`
							: itemNext
							? `Item should precede '${itemNext}'.`
							: "";
					this.error(
						`Wrong sorting: '${element}'. ${recommendation}`,
						false
					);
					failSorting = true;
				}
			}
		);
		if (failSorting) this.end(1);
		await asyncForEach(cnames, async (cname: Cname, index: number) => {
			this.setStatus(`Checking '${cname.key}...'`);
			if (!isURL(cname.target)) {
				this.error(
					`CNAME target is not a valid url: '${cname.key}' => '${cname.target}'`
				);
			}
			let cnameTarget: string = cname.target;
			if (
				!cnameTarget.startsWith("http://") &&
				!cnameTarget.startsWith("https://")
			) {
				cnameTarget = "http://" + cnameTarget;
			}
			this.setStatus(
				`Pinging '${cname.key}' (${new URL(cnameTarget).hostname})...`
			);
			try {
				const response = await fetch(
					`http://${new URL(cnameTarget).hostname}`,
					{
						timeout: 20000,
						headers: {
							host: `${
								cname.key != "" ? cname.key + "." : ""
							}js.org`,
						},
						redirect: "manual",
					}
				);
				if (!(response.status >= 200 && response.status <= 400)) {
					if (
						response.status === 301 ||
						response.status === 302 ||
						response.status === 307 ||
						response.status === 308
					) {
						if (
							response.headers.get("location") != null ||
							response.headers.get("Location") != null
						) {
							let location: string | null = response.headers.get(
								"location"
							)
								? response.headers.get("location")
								: response.headers.get("Location")
								? response.headers.get("Location")
								: "";
							location =
								location?.slice(-1) === "/"
									? location?.slice(-1)
									: location;
							if (
								location ==
								`https://${new URL(cnameTarget).hostname}`
							) {
								try {
									const response = await fetch(
										`https://${
											new URL(cnameTarget).hostname
										}`,
										{
											timeout: 20000,
											headers: {
												host: `${
													cname.key != ""
														? cname.key + "."
														: ""
												}js.org`,
											},
											redirect: "manual",
										}
									);
									if (
										!(
											response.status >= 200 &&
											response.status <= 400
										)
									) {
										this.warn(
											`Unreachable: '${cname.key}' => '${cname.target}' (${response.status} ${response.statusText})`
										);
									}
								} catch (e) {
									this.warn(
										`Unreachable: '${cname.key}' => '${cname.target}' (${e.message})`
									);
								}
							}
						}
					} else {
						this.warn(
							`Unreachable: '${cname.key}' => '${cname.target}' (${response.status} ${response.statusText})`
						);
					}
				}
			} catch (e) {
				this.warn(
					`Unreachable: '${cname.key}' => '${cname.target}' (${e.message})`
				);
			}
		});
		this.end(0);
	}

	warn(message: string) {
		let warnings: string[] = this.state.warnings;
		warnings.push(message);
		this.setState({
			warnings: warnings,
			warningCount: this.state.warningCount + 1,
		});
	}

	render() {
		return (
			<React.Fragment>
				<Box>
					<Text color="cyan">
						{!this.state.done && (
							<Fragment>
								<Spinner type="dots" />{" "}
							</Fragment>
						)}
						Status: {this.state.status}
					</Text>
				</Box>
				{this.state.warnings.map((warning) => {
					return (
						<Box key={`warning-${warning}`}>
							<Text color="yellow">
								{this.getEmoji("⚠️") + "  "}
								<Text bold>Warning:</Text> {warning}
							</Text>
						</Box>
					);
				})}
				{this.state.errors.map((error) => {
					return (
						<Box key={`error-${error}`}>
							<Text color="red">
								{this.getEmoji("❌") + " "}
								<Text bold>Error:</Text> {error}
							</Text>
						</Box>
					);
				})}
				{this.state.success && (
					<Box>
						<Text color="green" bold>
							🎉 Success! Everything looks good.
						</Text>
					</Box>
				)}
				{this.state.summary}
			</React.Fragment>
		);
	}
}

export function main() {
	render(<App />);
}
export default main;
