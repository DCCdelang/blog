from datetime import datetime
import os
import re

# Ask for the blog post title
title = input("Enter the blog post title: ").strip()

# Keep asking until valid input is provided
while True:
    html_or_md = input("Is the post in HTML or Markdown? (h/m): ").strip().lower()
    if html_or_md in ['h', 'm']:
        break
    print("Invalid input. Please enter 'h' for HTML or 'm' for Markdown.")

# Convert title to a URL-friendly format
slug = re.sub(r'\W+', '-', title.lower()).strip('-')

# Get today's date
now = datetime.now()
date_str = now.strftime('%Y-%m-%d')
date_stamp = now.strftime('%Y-%m-%d %H:%M:%S')


# Jekyll blog post template
post_content = f"""---
layout: post
title: "{title}"
date: {date_stamp} +01:00
categories: []
tags: []
published: false
hide_title: false
---


"""

# Ensure _posts directory exists
os.makedirs("_posts", exist_ok=True)

if html_or_md == 'h':
    filename = f"_posts/{date_str}-{slug}.html"
elif html_or_md == 'm':
    filename = f"_posts/{date_str}-{slug}.md"

# Write the file
with open(filename, "w", encoding="utf-8") as file:
    file.write(post_content)

print(f"Blog post template created: {filename}")
