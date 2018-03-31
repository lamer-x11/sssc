# SSSC

Simple and Stupid Slack Client

## Features

SSSC is closely modeled after [(ii)](https://tools.suckless.org/ii/) which means that communication is facilitated by an `out` file and an `in` FIFO on the filesystem.

No features other than sending and receiving messages while connected are supported. Retrieval of unread messages may be implemented at a later date, in a separate branch.

Incoming data not handled by SSSC will be printed to stdout as formatted JSON.

## Installation

```
$ yarn install
```

A Slack api token has to be provided as an environment variable called `TOKEN`. There's a Dockerfile included in the repository for convenience.

## Usage

Upon successful connection to Slack a directory with every channel, group and im will be created in the project root like so:

```
session/
'-- your_team_name/
    |-- general/
    |   |-- in
    |   '-- out
    |-- random/
    |   |-- in
    |   '-- out
    |-- alice/
    |   |-- in
    |   '-- out
    '-- bob/
        |-- in
        '-- out
```

To send a message to alice:

```
$ echo "Hi" > ./session/your_team_name/alice/in
```

To keep track of the conversation:

```
$ tail -f ./session/you_team_name/alice/out
```

Incoming messages are formatted as follows:

```
{timestamp} <{username}> {text}
```

It's up to the user to further process this output as needed using his preferred method of text manipulation.
