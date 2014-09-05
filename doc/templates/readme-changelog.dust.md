#Changelog

<table style="width:100%;border-spacing:0px;border-collapse:collapse;margin:0px;padding:0px;border-width:0px;">
   <tr>
    <th style="width:20px;text-align:center;"></th>
    <th style="width:80px;text-align:center;">Type</th> 
    <th style="width:80px;text-align:left;">ID</th>
    <th style="text-align:left;">Summary</th>
   </tr>
{#changelog.releases}
  <tr>
    <td colspan=4><strong>Version: {version.name} - released {version.releaseDate}</strong></td>
   </tr>
{#issues}
  <tr>
    <td style="width:20px;text-align:center;"><img src='{issuetype.iconUrl}'/></td> 
    <td style="width:80px;text-align:center;">{issuetype.name}</td> 
    <td style="width:80px;text-align:left;">{key}</td>
    <td>{summary}</td>
   </tr>
{/issues}
{/changelog.releases}
</table>