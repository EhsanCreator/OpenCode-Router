// ============================================================================
// OpenCode Router - Native Windows VPN Launcher (C#)
// Receives command-line arguments through native Windows argument parser (CommandLineToArgvW),
// resolves native executable or Node.js entry point, injects proxy environment variables,
// and launches OpenCode without cmd.exe metacharacter interpretation vulnerabilities.
// ============================================================================

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace OpenCodeRouter
{
    class Launcher
    {
        static int Main(string[] args)
        {
            try
            {
                // Prevent launcher from abruptly dying on Ctrl+C; let child process handle it
                Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
                {
                    e.Cancel = true;
                };

                string httpPort = Environment.GetEnvironmentVariable("OPENCODE_HTTP_PROXY_PORT");
                if (string.IsNullOrEmpty(httpPort)) httpPort = "10809";

                string socksPort = Environment.GetEnvironmentVariable("OPENCODE_SOCKS_PROXY_PORT");
                if (string.IsNullOrEmpty(socksPort)) socksPort = "10808";

                // 1. Detect external server targeting
                foreach (string arg in args)
                {
                    if (arg == "--attach" || arg == "--server" || arg == "attach" ||
                        arg.StartsWith("--attach=", StringComparison.OrdinalIgnoreCase) ||
                        arg.StartsWith("--server=", StringComparison.OrdinalIgnoreCase))
                    {
                        Console.Error.WriteLine("[OpenCode Router WARNING] Detected explicit --attach/--server parameter. Outgoing requests from an external OpenCode server are controlled by that server's process and may NOT route through this active proxy tunnel!");
                        break;
                    }
                }

                // 2. Resolve OpenCode target (binary or node.exe + js script)
                string execPath;
                string scriptPrefix;
                if (!ResolveTarget(out execPath, out scriptPrefix))
                {
                    Console.Error.WriteLine("[OpenCode Router ERROR] Could not locate 'opencode' executable or Node.js entry point. Ensure OpenCode CLI is installed.");
                    return 1;
                }

                // 3. Determine standalone flag injection
                bool injectStandalone = false;
                string firstArg = args.Length > 0 ? args[0] : "";
                string[] excludedSubcommands = new string[] {
                    "serve", "web", "attach", "completion", "models", "providers",
                    "auth", "stats", "export", "import", "github", "pr", "session",
                    "plugin", "db", "debug", "upgrade", "uninstall", "acp", "mcp"
                };

                if (string.IsNullOrEmpty(firstArg))
                {
                    injectStandalone = true;
                }
                else if (string.Equals(firstArg, "run", StringComparison.OrdinalIgnoreCase))
                {
                    injectStandalone = true;
                }
                else if (!firstArg.StartsWith("-") && Array.IndexOf(excludedSubcommands, firstArg.ToLowerInvariant()) < 0)
                {
                    injectStandalone = true;
                }

                if (Array.IndexOf(args, "--standalone") >= 0)
                {
                    injectStandalone = false;
                }

                // 4. Construct final argument list
                List<string> finalArgs = new List<string>();
                if (!string.IsNullOrEmpty(scriptPrefix))
                {
                    finalArgs.Add(scriptPrefix);
                }

                if (injectStandalone && CheckSupportsStandalone(execPath, scriptPrefix))
                {
                    if (string.Equals(firstArg, "run", StringComparison.OrdinalIgnoreCase))
                    {
                        finalArgs.Add("run");
                        finalArgs.Add("--standalone");
                        for (int i = 1; i < args.Length; i++)
                        {
                            finalArgs.Add(args[i]);
                        }
                    }
                    else
                    {
                        finalArgs.Add("--standalone");
                        finalArgs.AddRange(args);
                    }
                }
                else
                {
                    finalArgs.AddRange(args);
                }

                // 5. Configure ProcessStartInfo with proxy environment variables
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = execPath;
                psi.Arguments = FormatCommandLineArgs(finalArgs);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = false;

                // Explicitly inject proxy environment variables for child process only
                psi.EnvironmentVariables["HTTP_PROXY"] = "http://127.0.0.1:" + httpPort;
                psi.EnvironmentVariables["HTTPS_PROXY"] = "http://127.0.0.1:" + httpPort;
                psi.EnvironmentVariables["http_proxy"] = "http://127.0.0.1:" + httpPort;
                psi.EnvironmentVariables["https_proxy"] = "http://127.0.0.1:" + httpPort;
                psi.EnvironmentVariables["ALL_PROXY"] = "socks5://127.0.0.1:" + socksPort;
                psi.EnvironmentVariables["all_proxy"] = "socks5://127.0.0.1:" + socksPort;
                psi.EnvironmentVariables["NO_PROXY"] = "localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1";
                psi.EnvironmentVariables["no_proxy"] = "localhost,127.0.0.1,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,192.168.18.1";

                // 6. Launch child process and preserve interactive console & exit code
                using (Process proc = Process.Start(psi))
                {
                    if (proc == null)
                    {
                        Console.Error.WriteLine("[OpenCode Router ERROR] Failed to spawn process: " + execPath);
                        return 1;
                    }

                    proc.WaitForExit();
                    return proc.ExitCode;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[OpenCode Router Launcher Error] " + ex.Message);
                return 1;
            }
        }

        static bool ResolveTarget(out string execPath, out string scriptPrefix)
        {
            execPath = null;
            scriptPrefix = null;

            // 1. Explicit OPENCODE_BIN
            string custom = Environment.GetEnvironmentVariable("OPENCODE_BIN");
            if (!string.IsNullOrEmpty(custom) && File.Exists(custom))
            {
                if (custom.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || custom.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
                {
                    return ResolveBatchShim(custom, out execPath, out scriptPrefix);
                }
                execPath = custom;
                return true;
            }

            // 2. Standard native binary locations
            string localApp = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            if (!string.IsNullOrEmpty(localApp))
            {
                string p = Path.Combine(localApp, @"Programs\opencode\opencode.exe");
                if (File.Exists(p)) { execPath = p; return true; }
            }

            string appData = Environment.GetEnvironmentVariable("APPDATA");
            if (!string.IsNullOrEmpty(appData))
            {
                string p1 = Path.Combine(appData, @"npm\node_modules\opencode-ai\bin\opencode.exe");
                if (File.Exists(p1)) { execPath = p1; return true; }

                string p2 = Path.Combine(appData, @"npm\opencode.exe");
                if (File.Exists(p2)) { execPath = p2; return true; }
            }

            // 3. Search PATH for native opencode.exe
            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathEnv))
            {
                string[] dirs = pathEnv.Split(';');
                foreach (string dir in dirs)
                {
                    if (string.IsNullOrEmpty(dir)) continue;
                    try
                    {
                        string candidateExe = Path.Combine(dir.Trim(), "opencode.exe");
                        if (File.Exists(candidateExe)) { execPath = candidateExe; return true; }
                    }
                    catch { }
                }
            }

            // 4. Search for npm shims and resolve to node.exe + opencode.js
            if (!string.IsNullOrEmpty(appData))
            {
                string npmCmd = Path.Combine(appData, @"npm\opencode.cmd");
                if (File.Exists(npmCmd))
                {
                    if (ResolveBatchShim(npmCmd, out execPath, out scriptPrefix)) return true;
                }
            }

            if (!string.IsNullOrEmpty(pathEnv))
            {
                string[] dirs = pathEnv.Split(';');
                foreach (string dir in dirs)
                {
                    if (string.IsNullOrEmpty(dir)) continue;
                    try
                    {
                        string candidateCmd = Path.Combine(dir.Trim(), "opencode.cmd");
                        if (File.Exists(candidateCmd))
                        {
                            if (ResolveBatchShim(candidateCmd, out execPath, out scriptPrefix)) return true;
                        }
                    }
                    catch { }
                }
            }

            // Fallback: check if opencode is a native binary in PATH
            execPath = "opencode";
            return true;
        }

        static bool ResolveBatchShim(string cmdPath, out string execPath, out string scriptPrefix)
        {
            execPath = null;
            scriptPrefix = null;
            try
            {
                string content = File.ReadAllText(cmdPath);
                // Look for: node "%~dp0\node_modules\...\opencode.js" or similar
                Match m = Regex.Match(content, @"(?:""%~dp0\\node\.exe""|node)\s+""?([^""\r\n]+\.js)""?", RegexOptions.IgnoreCase);
                if (m.Success)
                {
                    string jsRelOrAbs = m.Groups[1].Value.Replace("%~dp0", Path.GetDirectoryName(cmdPath) + "\\");
                    string jsPath = Path.GetFullPath(jsRelOrAbs);
                    if (File.Exists(jsPath))
                    {
                        // Locate node.exe
                        string nodeExe = ResolveNodeExe(Path.GetDirectoryName(cmdPath));
                        if (!string.IsNullOrEmpty(nodeExe))
                        {
                            execPath = nodeExe;
                            scriptPrefix = jsPath;
                            return true;
                        }
                    }
                }
            }
            catch { }

            // If we cannot safely unwrap batch file, refuse execution unless OPENCODE_ALLOW_UNSAFE_SHELL=1
            if (string.Equals(Environment.GetEnvironmentVariable("OPENCODE_ALLOW_UNSAFE_SHELL"), "1"))
            {
                execPath = cmdPath;
                return true;
            }

            Console.Error.WriteLine("[OpenCode Router WARNING] OpenCode installation at '" + cmdPath + "' is a batch wrapper that cannot guarantee argument safety. Install a native binary or configure OPENCODE_BIN to target node.exe + entrypoint directly.");
            return false;
        }

        static string ResolveNodeExe(string hintDir)
        {
            if (!string.IsNullOrEmpty(hintDir))
            {
                string localNode = Path.Combine(hintDir, "node.exe");
                if (File.Exists(localNode)) return localNode;
            }

            string pathEnv = Environment.GetEnvironmentVariable("PATH");
            if (!string.IsNullOrEmpty(pathEnv))
            {
                foreach (string dir in pathEnv.Split(';'))
                {
                    if (string.IsNullOrEmpty(dir)) continue;
                    try
                    {
                        string p = Path.Combine(dir.Trim(), "node.exe");
                        if (File.Exists(p)) return p;
                    }
                    catch { }
                }
            }

            return "node.exe";
        }

        static bool CheckSupportsStandalone(string binaryPath, string scriptPrefix)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = binaryPath;
                if (!string.IsNullOrEmpty(scriptPrefix))
                {
                    psi.Arguments = QuoteArgument(scriptPrefix) + " --help";
                }
                else
                {
                    psi.Arguments = "--help";
                }
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;

                using (Process p = Process.Start(psi))
                {
                    if (p == null) return false;
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    return output.Contains("--standalone");
                }
            }
            catch
            {
                return false;
            }
        }

        static string FormatCommandLineArgs(IEnumerable<string> args)
        {
            StringBuilder sb = new StringBuilder();
            foreach (string arg in args)
            {
                if (sb.Length > 0) sb.Append(" ");
                sb.Append(QuoteArgument(arg));
            }
            return sb.ToString();
        }

        static string QuoteArgument(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            if (!arg.Contains(" ") && !arg.Contains("\t") && !arg.Contains("\"") && !arg.Contains("\n") && !arg.Contains("\r"))
            {
                return arg;
            }

            StringBuilder sb = new StringBuilder();
            sb.Append("\"");
            for (int i = 0; i < arg.Length; i++)
            {
                int backslashCount = 0;
                while (i < arg.Length && arg[i] == '\\')
                {
                    backslashCount++;
                    i++;
                }

                if (i == arg.Length)
                {
                    sb.Append(new string('\\', backslashCount * 2));
                    break;
                }

                if (arg[i] == '"')
                {
                    sb.Append(new string('\\', backslashCount * 2 + 1));
                    sb.Append('"');
                }
                else
                {
                    sb.Append(new string('\\', backslashCount));
                    sb.Append(arg[i]);
                }
            }
            sb.Append("\"");
            return sb.ToString();
        }
    }
}
